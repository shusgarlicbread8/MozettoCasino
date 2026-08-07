/**
 * WP-077 metrics: latency buckets, reliability, Energy spend, rough EV/bb stub,
 * and profile separation proxies (VPIP / PFR / aggression).
 */

import { ACTION_NAME_BY_TYPE, type ActionTypeCode } from "../provider/action-codes.js";
import type { DecisionResult } from "../provider/types.js";
import type { PresetKey } from "../policy/presets.js";
import type { EvalScenario } from "./scenarios.js";

export const LATENCY_BUCKET_EDGES_MS = [50, 100, 250, 500, 1000, 2000, 5000] as const;

export interface DecisionSample {
  profileKey: PresetKey;
  scenarioId: string;
  street: string;
  actionType: ActionTypeCode;
  actionName: string;
  amount: string;
  fallbackUsed: boolean;
  illegalActionFallback: boolean;
  providerLatencyMs: number;
  energyDebited: number;
  /** Rough stub EV in big blinds for this decision (not engine equity). */
  evStubBb: number;
  errorClass?: string;
  voluntaryPutMoney: boolean;
  preflopRaise: boolean;
  aggressive: boolean;
}

export interface LatencyStats {
  count: number;
  p50: number;
  p95: number;
  p99: number;
  mean: number;
  buckets: Record<string, number>;
}

export interface ProfileMetrics {
  profileKey: PresetKey;
  decisions: number;
  fallbackRate: number;
  illegalActionRate: number;
  energySpent: number;
  energyPerDecision: number;
  /** Sum of stub EV in BB / (decisions/100) — rough bb/100 proxy. */
  bbPer100Stub: number;
  vpip: number;
  pfr: number;
  aggressionFrequency: number;
  actionHistogram: Record<string, number>;
  latency: LatencyStats;
}

export interface SeparationReport {
  /** Pairwise L1 distance of action histograms (normalized). */
  pairwiseActionL1: Array<{ a: PresetKey; b: PresetKey; distance: number }>;
  /** Max pairwise L1 — higher ⇒ more distinct profiles. */
  maxPairwiseL1: number;
  /** Min pairwise L1 across distinct presets. */
  minPairwiseL1: number;
  /** True when min pairwise L1 ≥ threshold (default 0.08). */
  separated: boolean;
  threshold: number;
}

export interface EvalReport {
  workPacket: "WP-077";
  mode: "mock" | "live";
  seed: string;
  startedAt: string;
  finishedAt: string;
  totalDecisions: number;
  profiles: ProfileMetrics[];
  overall: {
    fallbackRate: number;
    illegalActionRate: number;
    energySpent: number;
    latency: LatencyStats;
  };
  separation: SeparationReport;
  notes: string[];
}

export function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  if (sorted.length === 1) return sorted[0]!;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  const w = idx - lo;
  return sorted[lo]! * (1 - w) + sorted[hi]! * w;
}

export function latencyBuckets(latencies: number[]): LatencyStats {
  const sorted = [...latencies].sort((a, b) => a - b);
  const buckets: Record<string, number> = {};
  for (const edge of LATENCY_BUCKET_EDGES_MS) {
    buckets[`le_${edge}`] = 0;
  }
  buckets.gt_5000 = 0;
  for (const ms of latencies) {
    let placed = false;
    for (const edge of LATENCY_BUCKET_EDGES_MS) {
      if (ms <= edge) {
        buckets[`le_${edge}`]! += 1;
        placed = true;
        break;
      }
    }
    if (!placed) buckets.gt_5000! += 1;
  }
  const mean = latencies.length
    ? latencies.reduce((a, b) => a + b, 0) / latencies.length
    : 0;
  return {
    count: latencies.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    mean,
    buckets,
  };
}

export function scoreEvStub(scenario: EvalScenario, actionType: ActionTypeCode): number {
  const name = ACTION_NAME_BY_TYPE[actionType];
  return scenario.evStubBb[name] ?? 0;
}

export function classifyDecision(
  scenario: EvalScenario,
  result: DecisionResult,
): Pick<DecisionSample, "voluntaryPutMoney" | "preflopRaise" | "aggressive" | "illegalActionFallback"> {
  const name = ACTION_NAME_BY_TYPE[result.actionType];
  const street = scenario.observation.street ?? "";
  const facing =
    Number(scenario.observation.callAmount ?? 0) > 0 ||
    scenario.legalActions.some((a) => a.action === "fold");
  const voluntaryPutMoney =
    name === "bet" ||
    name === "raise" ||
    name === "all_in" ||
    (name === "call" && facing);
  const preflopRaise = street === "preflop" && (name === "raise" || name === "bet");
  const aggressive = name === "bet" || name === "raise" || name === "all_in";
  const illegalActionFallback =
    result.errorClass === "illegal_action" ||
    result.reasonCode === 13; /* ILLEGAL_ACTION_FALLBACK */
  return { voluntaryPutMoney, preflopRaise, aggressive, illegalActionFallback };
}

function actionHist(samples: DecisionSample[]): Record<string, number> {
  const h: Record<string, number> = {};
  for (const s of samples) {
    h[s.actionName] = (h[s.actionName] ?? 0) + 1;
  }
  return h;
}

function normalizeHist(h: Record<string, number>): Record<string, number> {
  const total = Object.values(h).reduce((a, b) => a + b, 0) || 1;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(h)) out[k] = v / total;
  return out;
}

function l1Distance(a: Record<string, number>, b: Record<string, number>): number {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let sum = 0;
  for (const k of keys) {
    sum += Math.abs((a[k] ?? 0) - (b[k] ?? 0));
  }
  return sum / 2; // total variation distance
}

export function computeProfileMetrics(
  profileKey: PresetKey,
  samples: DecisionSample[],
): ProfileMetrics {
  const latencies = samples.map((s) => s.providerLatencyMs);
  const fallbacks = samples.filter((s) => s.fallbackUsed).length;
  const illegals = samples.filter((s) => s.illegalActionFallback).length;
  const energySpent = samples.reduce((a, s) => a + s.energyDebited, 0);
  const evSum = samples.reduce((a, s) => a + s.evStubBb, 0);
  const n = samples.length || 1;
  const voluntaries = samples.filter((s) => s.voluntaryPutMoney).length;
  const pfrs = samples.filter((s) => s.preflopRaise).length;
  const preflop = samples.filter((s) => s.street === "preflop");
  const agg = samples.filter((s) => s.aggressive).length;
  const passiveContinue = samples.filter(
    (s) => s.actionName === "call" || s.actionName === "check",
  ).length;
  const agrDenom = agg + passiveContinue || 1;

  return {
    profileKey,
    decisions: samples.length,
    fallbackRate: fallbacks / n,
    illegalActionRate: illegals / n,
    energySpent,
    energyPerDecision: energySpent / n,
    bbPer100Stub: (evSum / n) * 100,
    vpip: voluntaries / n,
    pfr: preflop.length ? pfrs / preflop.length : 0,
    aggressionFrequency: agg / agrDenom,
    actionHistogram: actionHist(samples),
    latency: latencyBuckets(latencies),
  };
}

export function computeSeparation(
  profiles: ProfileMetrics[],
  threshold = 0.08,
): SeparationReport {
  const pairwise: SeparationReport["pairwiseActionL1"] = [];
  for (let i = 0; i < profiles.length; i++) {
    for (let j = i + 1; j < profiles.length; j++) {
      const a = profiles[i]!;
      const b = profiles[j]!;
      const distance = l1Distance(
        normalizeHist(a.actionHistogram),
        normalizeHist(b.actionHistogram),
      );
      pairwise.push({ a: a.profileKey, b: b.profileKey, distance });
    }
  }
  const distances = pairwise.map((p) => p.distance);
  const maxPairwiseL1 = distances.length ? Math.max(...distances) : 0;
  const minPairwiseL1 = distances.length ? Math.min(...distances) : 0;
  return {
    pairwiseActionL1: pairwise,
    maxPairwiseL1,
    minPairwiseL1,
    separated: minPairwiseL1 >= threshold,
    threshold,
  };
}

export function buildReport(input: {
  mode: "mock" | "live";
  seed: string;
  startedAt: string;
  finishedAt: string;
  samples: DecisionSample[];
  notes?: string[];
  separationThreshold?: number;
}): EvalReport {
  const byProfile = new Map<PresetKey, DecisionSample[]>();
  for (const s of input.samples) {
    const list = byProfile.get(s.profileKey) ?? [];
    list.push(s);
    byProfile.set(s.profileKey, list);
  }
  const profiles = [...byProfile.entries()].map(([k, v]) => computeProfileMetrics(k, v));
  const all = input.samples;
  const n = all.length || 1;
  return {
    workPacket: "WP-077",
    mode: input.mode,
    seed: input.seed,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    totalDecisions: all.length,
    profiles,
    overall: {
      fallbackRate: all.filter((s) => s.fallbackUsed).length / n,
      illegalActionRate: all.filter((s) => s.illegalActionFallback).length / n,
      energySpent: all.reduce((a, s) => a + s.energyDebited, 0),
      latency: latencyBuckets(all.map((s) => s.providerLatencyMs)),
    },
    separation: computeSeparation(profiles, input.separationThreshold ?? 0.08),
    notes: input.notes ?? [],
  };
}
