/**
 * WP-111 — live per-hand COGS ledger (Groq tokens + placeholders + rake).
 *
 * Persists JSONL when ECONOMICS_LEDGER_PATH is set. Aggregates via
 * `@mozetto/unit-economics` without freezing Season 1 rake into GameTemplates.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  buildHandCostReport,
  buildSessionCostReport,
  estimateGroqCostUsdMicro,
  placeholdersFromEnv,
  serializeHandCostReport,
  serializeSessionCostReport,
  type CogsPlaceholderOverrides,
  type HandCostBreakdown,
  type HandCostDecisionSample,
  type HandCostInput,
  type SessionCostReport,
} from "@mozetto/unit-economics";
import type { LiveDecisionSample, LiveTableMetricsSnapshot } from "./metrics.js";

export type EconomicsDecisionSample = LiveDecisionSample & {
  promptTokens: number;
  completionTokens: number;
  aiCogsUsdMicro: bigint;
};

export type HandEconomicsState = {
  sessionId: string;
  handId: string;
  rakeRevenue: bigint;
  rakeKnown: boolean;
  decisions: EconomicsDecisionSample[];
  energySpent: number;
  closed: boolean;
  atMs: number;
};

export type EconomicsSnapshot = {
  workPacket: "WP-111";
  status: "hypothesis";
  openHands: number;
  closedHands: number;
  decisions: number;
  promptTokens: number;
  completionTokens: number;
  aiCogsUsdMicro: string;
  rakeRevenueTotal: string;
  sessionReport: ReturnType<typeof serializeSessionCostReport> | null;
  liveMetrics?: LiveTableMetricsSnapshot;
  notes: string[];
};

export type EconomicsLedgerOptions = {
  placeholders?: CogsPlaceholderOverrides;
  /** Append JSONL hand records when set. */
  ledgerPath?: string | null;
  now?: () => number;
  env?: NodeJS.ProcessEnv;
};

function handKey(sessionId: string, handId: string): string {
  return `${sessionId}:${handId}`;
}

export class EconomicsLedger {
  private hands = new Map<string, HandEconomicsState>();
  private closed: HandCostBreakdown[] = [];
  private readonly placeholders: CogsPlaceholderOverrides;
  private readonly ledgerPath: string | null;
  private readonly now: () => number;

  constructor(opts: EconomicsLedgerOptions = {}) {
    const env = opts.env ?? process.env;
    this.placeholders = opts.placeholders ?? placeholdersFromEnv(env);
    this.ledgerPath = opts.ledgerPath ?? env.ECONOMICS_LEDGER_PATH ?? null;
    this.now = opts.now ?? (() => Date.now());
  }

  beginHand(meta: { sessionId: string; handId: string }): void {
    const key = handKey(meta.sessionId, meta.handId);
    this.hands.set(key, {
      sessionId: meta.sessionId,
      handId: meta.handId,
      rakeRevenue: 0n,
      rakeKnown: false,
      decisions: [],
      energySpent: 0,
      closed: false,
      atMs: this.now(),
    });
  }

  recordDecision(sample: EconomicsDecisionSample): void {
    const key = handKey(sample.sessionId, sample.handId);
    let hand = this.hands.get(key);
    if (!hand) {
      this.beginHand({ sessionId: sample.sessionId, handId: sample.handId });
      hand = this.hands.get(key)!;
    }
    if (hand.closed) return;
    hand.decisions.push(sample);
    hand.energySpent += sample.energyDebited;
  }

  /**
   * Record rake for a hand (chips / USDC accounting units as bigint string).
   * Call on HAND_SETTLED — does not invent rake when unknown.
   */
  recordRake(meta: {
    sessionId: string;
    handId: string;
    rakeRevenue: bigint | number | string;
  }): void {
    const key = handKey(meta.sessionId, meta.handId);
    let hand = this.hands.get(key);
    if (!hand) {
      this.beginHand({ sessionId: meta.sessionId, handId: meta.handId });
      hand = this.hands.get(key)!;
    }
    try {
      hand.rakeRevenue = BigInt(meta.rakeRevenue);
      hand.rakeKnown = true;
    } catch {
      hand.rakeRevenue = 0n;
      hand.rakeKnown = false;
    }
  }

  endHand(meta: {
    sessionId: string;
    handId: string;
    rakeRevenue?: bigint | number | string | null;
  }): HandCostBreakdown | null {
    const key = handKey(meta.sessionId, meta.handId);
    const hand = this.hands.get(key);
    if (!hand || hand.closed) return null;

    if (meta.rakeRevenue != null && meta.rakeRevenue !== "") {
      this.recordRake({
        sessionId: meta.sessionId,
        handId: meta.handId,
        rakeRevenue: meta.rakeRevenue,
      });
    }

    const decisions: HandCostDecisionSample[] = hand.decisions.map((d) => ({
      seat: d.seat,
      profileKey: d.profileKey,
      promptTokens: d.promptTokens,
      completionTokens: d.completionTokens,
      aiCogsUsdMicro: d.aiCogsUsdMicro,
      energyDebited: d.energyDebited,
      fallbackUsed: d.fallbackUsed,
      providerLatencyMs: d.providerLatencyMs,
      modelId: d.modelId,
    }));

    const input: HandCostInput = {
      sessionId: hand.sessionId,
      handId: hand.handId,
      rakeRevenue: hand.rakeRevenue,
      decisions,
      placeholders: this.placeholders,
      atMs: this.now(),
    };
    const report = buildHandCostReport(input);
    if (!hand.rakeKnown) {
      report.notes.push(
        "Rake not reported for this hand — contribution uses rakeRevenue=0 until HAND_SETTLED wire.",
      );
    }
    hand.closed = true;
    this.closed.push(report);
    this.hands.delete(key);
    this.persist(report);
    return report;
  }

  sessionReport(sessionId?: string | null): SessionCostReport {
    const hands = sessionId
      ? this.closed.filter((h) => h.sessionId === sessionId)
      : this.closed;
    return buildSessionCostReport({ hands, sessionId: sessionId ?? null });
  }

  snapshot(liveMetrics?: LiveTableMetricsSnapshot): EconomicsSnapshot {
    const report = this.closed.length
      ? serializeSessionCostReport(this.sessionReport())
      : null;
    let promptTokens = 0;
    let completionTokens = 0;
    let aiCogs = 0n;
    let rake = 0n;
    let decisions = 0;
    for (const h of this.closed) {
      promptTokens += h.detail.promptTokens;
      completionTokens += h.detail.completionTokens;
      aiCogs += h.aiCogs;
      rake += h.rakeRevenue;
      decisions += h.detail.decisions;
    }
    for (const h of this.hands.values()) {
      for (const d of h.decisions) {
        promptTokens += d.promptTokens;
        completionTokens += d.completionTokens;
        aiCogs += d.aiCogsUsdMicro;
        decisions += 1;
      }
      rake += h.rakeRevenue;
    }

    return {
      workPacket: "WP-111",
      status: "hypothesis",
      openHands: this.hands.size,
      closedHands: this.closed.length,
      decisions,
      promptTokens,
      completionTokens,
      aiCogsUsdMicro: aiCogs.toString(),
      rakeRevenueTotal: rake.toString(),
      sessionReport: report,
      liveMetrics,
      notes: [
        "WP-111 COGS instrumentation — Groq tokens measured when provider returns usage.",
        "Chain/VRF/relayer/cloud rates are hypotheses (placeholders).",
        "Season 1 rake schedule remains hypothesis — not a GameTemplate freeze.",
      ],
    };
  }

  reset(): void {
    this.hands.clear();
    this.closed = [];
  }

  private persist(report: HandCostBreakdown): void {
    if (!this.ledgerPath) return;
    try {
      mkdirSync(dirname(this.ledgerPath), { recursive: true });
      const line = JSON.stringify({
        ...serializeHandCostReport(report),
        decisions: report.detail.decisions,
      });
      appendFileSync(this.ledgerPath, `${line}\n`, "utf8");
    } catch {
      // Persistence is best-effort — never break the table path.
    }
  }
}

/** Attach Groq cost estimate to a live decision sample. */
export function enrichDecisionForEconomics(
  sample: LiveDecisionSample,
  tokens?: { promptTokens?: number; completionTokens?: number } | null,
): EconomicsDecisionSample {
  const promptTokens = Math.max(0, Math.floor(tokens?.promptTokens ?? 0));
  const completionTokens = Math.max(0, Math.floor(tokens?.completionTokens ?? 0));
  return {
    ...sample,
    promptTokens,
    completionTokens,
    aiCogsUsdMicro: estimateGroqCostUsdMicro({ promptTokens, completionTokens }),
  };
}
