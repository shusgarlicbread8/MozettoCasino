/**
 * WP-111 — per-hand / per-session COGS records + aggregation.
 *
 * Combines measured AI tokens (when present), rake contribution, and
 * chain/VRF/relayer/cloud placeholders into Plan 11 contribution identity.
 */

import { computeContribution, type ContributionResult } from "./contribution.js";
import { classifyAiCostBand, type CostBandLevel } from "./energy-bands.js";
import {
  COGS_PRICING_STATUS,
  estimateChainCogsUsdMicro,
  estimateGroqCostUsdMicro,
  estimateInfraCogsUsdMicro,
  type CogsPlaceholderOverrides,
  type TokenUsage,
  SEASON1_CHAIN_INFRA_PLACEHOLDERS_USD_MICRO,
  SEASON1_GROQ_TOKEN_PRICING_USD_MICRO_PER_MTOK,
} from "./pricing.js";

export type HandCostDecisionSample = {
  seat: number;
  profileKey?: string;
  promptTokens: number;
  completionTokens: number;
  /** Measured AI cost for this decision (USD micro); computed if omitted. */
  aiCogsUsdMicro?: bigint;
  energyDebited?: number;
  fallbackUsed?: boolean;
  providerLatencyMs?: number;
  modelId?: string;
};

export type HandCostInput = {
  sessionId: string;
  handId: string;
  /** Gross rake for this hand in accounting units (USDC raw or chip-equivalent). */
  rakeRevenue: bigint;
  rakeRefunds?: bigint;
  decisions?: HandCostDecisionSample[];
  /** Aggregate tokens when decision samples are unavailable. */
  tokenUsage?: TokenUsage;
  /** Override measured AI COGS (USD micro). */
  aiCogsUsdMicro?: bigint;
  placeholders?: CogsPlaceholderOverrides;
  /** When true, chain/infra placeholders are applied (default true). */
  applyPlaceholders?: boolean;
  league?: string | null;
  atMs?: number;
};

export type HandCostBreakdown = {
  status: typeof COGS_PRICING_STATUS;
  sessionId: string;
  handId: string;
  league: string | null;
  rakeRevenue: bigint;
  aiCogs: bigint;
  chainCogs: bigint;
  infrastructureCogs: bigint;
  /** Detail — still rolled into chainCogs for contribution. */
  detail: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    groqCostUsdMicro: bigint;
    chainGasUsdMicro: bigint;
    vrfUsdMicro: bigint;
    relayerUsdMicro: bigint;
    cloudUsdMicro: bigint;
    energyDebited: number;
    decisions: number;
    fallbackCount: number;
    aiCostBand: CostBandLevel;
  };
  contribution: ContributionResult;
  notes: string[];
  atMs: number;
};

export type SessionCostReport = {
  workPacket: "WP-111";
  status: typeof COGS_PRICING_STATUS;
  scheduleStatus: "hypothesis";
  season1FeePolicy: "poker_rake_only";
  sessionId: string | null;
  hands: number;
  decisions: number;
  grossRake: bigint;
  totalAiCogs: bigint;
  totalChainCogs: bigint;
  totalInfrastructureCogs: bigint;
  totalCogs: bigint;
  protocolContribution: bigint;
  avgAiCogsPerHand: bigint;
  avgContributionPerHand: bigint;
  promptTokens: number;
  completionTokens: number;
  energyDebitedTotal: number;
  fallbackCount: number;
  handReports: HandCostBreakdown[];
  pricing: {
    groq: typeof SEASON1_GROQ_TOKEN_PRICING_USD_MICRO_PER_MTOK;
    placeholders: typeof SEASON1_CHAIN_INFRA_PLACEHOLDERS_USD_MICRO;
  };
  notes: string[];
  generatedAt: string;
};

function sumTokens(decisions: HandCostDecisionSample[]): TokenUsage {
  let promptTokens = 0;
  let completionTokens = 0;
  for (const d of decisions) {
    promptTokens += Math.max(0, d.promptTokens);
    completionTokens += Math.max(0, d.completionTokens);
  }
  return { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens };
}

/** Build a single-hand COGS + contribution record. */
export function buildHandCostReport(input: HandCostInput): HandCostBreakdown {
  const notes: string[] = [
    "Season 1 charges poker rake only — AI/chain/infra are internal COGS.",
    "Pricing and placeholders are hypotheses — not GameTemplate freezes.",
  ];
  const decisions = input.decisions ?? [];
  const tokens = input.tokenUsage ?? sumTokens(decisions);
  const promptTokens = Math.max(0, tokens.promptTokens);
  const completionTokens = Math.max(0, tokens.completionTokens);

  let groqCost =
    input.aiCogsUsdMicro ??
    decisions.reduce((acc, d) => {
      if (d.aiCogsUsdMicro != null) return acc + d.aiCogsUsdMicro;
      return (
        acc +
        estimateGroqCostUsdMicro({
          promptTokens: d.promptTokens,
          completionTokens: d.completionTokens,
        })
      );
    }, 0n);

  if (input.aiCogsUsdMicro == null && decisions.length === 0) {
    groqCost = estimateGroqCostUsdMicro({ promptTokens, completionTokens });
  }

  const apply = input.applyPlaceholders !== false;
  const ph = input.placeholders ?? {};
  const base = SEASON1_CHAIN_INFRA_PLACEHOLDERS_USD_MICRO;
  const chainGas = apply ? (ph.chainGasPerHand ?? base.chainGasPerHand) : 0n;
  const vrf = apply ? (ph.vrfPerHand ?? base.vrfPerHand) : 0n;
  const relayer = apply ? (ph.relayerPerHand ?? base.relayerPerHand) : 0n;
  const cloud = apply ? (ph.cloudPerHand ?? base.cloudPerHand) : 0n;

  if (!apply) {
    notes.push("Placeholders disabled — chain/infra COGS set to 0 for this report.");
  } else {
    notes.push(base.note);
  }
  if (promptTokens === 0 && completionTokens === 0 && groqCost === 0n) {
    notes.push("No Groq token usage recorded — AI COGS may understate live cost (mock/fallback).");
  }

  const chainCogs = estimateChainCogsUsdMicro({
    chainGasPerHand: chainGas,
    vrfPerHand: vrf,
    relayerPerHand: relayer,
  });
  const infrastructureCogs = estimateInfraCogsUsdMicro({ cloudPerHand: cloud });
  const energyDebited = decisions.reduce((a, d) => a + (d.energyDebited ?? 0), 0);
  const fallbackCount = decisions.filter((d) => d.fallbackUsed).length;

  const contribution = computeContribution({
    rakeRevenue: input.rakeRevenue,
    rakeRefunds: input.rakeRefunds,
    aiCogs: groqCost,
    chainCogs,
    infrastructureCogs,
  });

  return {
    status: COGS_PRICING_STATUS,
    sessionId: input.sessionId,
    handId: input.handId,
    league: input.league ?? null,
    rakeRevenue: input.rakeRevenue,
    aiCogs: groqCost,
    chainCogs,
    infrastructureCogs,
    detail: {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      groqCostUsdMicro: groqCost,
      chainGasUsdMicro: chainGas,
      vrfUsdMicro: vrf,
      relayerUsdMicro: relayer,
      cloudUsdMicro: cloud,
      energyDebited,
      decisions: decisions.length,
      fallbackCount,
      aiCostBand: classifyAiCostBand(groqCost),
    },
    contribution,
    notes,
    atMs: input.atMs ?? Date.now(),
  };
}

/** Aggregate hand reports into a session / Stage A cost report. */
export function buildSessionCostReport(opts: {
  hands: HandCostInput[] | HandCostBreakdown[];
  sessionId?: string | null;
}): SessionCostReport {
  const handReports: HandCostBreakdown[] = opts.hands.map((h) =>
    "contribution" in h && "detail" in h
      ? (h as HandCostBreakdown)
      : buildHandCostReport(h as HandCostInput),
  );

  let grossRake = 0n;
  let totalAi = 0n;
  let totalChain = 0n;
  let totalInfra = 0n;
  let promptTokens = 0;
  let completionTokens = 0;
  let energyDebitedTotal = 0;
  let fallbackCount = 0;
  let decisions = 0;

  for (const h of handReports) {
    grossRake += h.rakeRevenue;
    totalAi += h.aiCogs;
    totalChain += h.chainCogs;
    totalInfra += h.infrastructureCogs;
    promptTokens += h.detail.promptTokens;
    completionTokens += h.detail.completionTokens;
    energyDebitedTotal += h.detail.energyDebited;
    fallbackCount += h.detail.fallbackCount;
    decisions += h.detail.decisions;
  }

  const n = BigInt(handReports.length || 1);
  const totalCogs = totalAi + totalChain + totalInfra;
  const protocolContribution = grossRake - totalCogs;
  const sessionId =
    opts.sessionId ??
    handReports[0]?.sessionId ??
    null;

  return {
    workPacket: "WP-111",
    status: COGS_PRICING_STATUS,
    scheduleStatus: "hypothesis",
    season1FeePolicy: "poker_rake_only",
    sessionId,
    hands: handReports.length,
    decisions,
    grossRake,
    totalAiCogs: totalAi,
    totalChainCogs: totalChain,
    totalInfrastructureCogs: totalInfra,
    totalCogs,
    protocolContribution,
    avgAiCogsPerHand: handReports.length ? totalAi / n : 0n,
    avgContributionPerHand: handReports.length ? protocolContribution / n : 0n,
    promptTokens,
    completionTokens,
    energyDebitedTotal,
    fallbackCount,
    handReports,
    pricing: {
      groq: SEASON1_GROQ_TOKEN_PRICING_USD_MICRO_PER_MTOK,
      placeholders: SEASON1_CHAIN_INFRA_PLACEHOLDERS_USD_MICRO,
    },
    notes: [
      "Contribution = net rake − AI − chain − infra (Plan 11).",
      "Season 1 rake schedule remains hypothesis until empirical COGS + Safe/timelock freeze.",
      "Do not silently freeze rake into GameTemplates from this report.",
    ],
    generatedAt: new Date().toISOString(),
  };
}

/** JSON-safe serialization (bigint → string). */
export function serializeHandCostReport(report: HandCostBreakdown) {
  return {
    ...report,
    rakeRevenue: report.rakeRevenue.toString(),
    aiCogs: report.aiCogs.toString(),
    chainCogs: report.chainCogs.toString(),
    infrastructureCogs: report.infrastructureCogs.toString(),
    detail: {
      ...report.detail,
      groqCostUsdMicro: report.detail.groqCostUsdMicro.toString(),
      chainGasUsdMicro: report.detail.chainGasUsdMicro.toString(),
      vrfUsdMicro: report.detail.vrfUsdMicro.toString(),
      relayerUsdMicro: report.detail.relayerUsdMicro.toString(),
      cloudUsdMicro: report.detail.cloudUsdMicro.toString(),
    },
    contribution: {
      grossRake: report.contribution.grossRake.toString(),
      netRake: report.contribution.netRake.toString(),
      totalCogs: report.contribution.totalCogs.toString(),
      protocolContribution: report.contribution.protocolContribution.toString(),
      cogs: {
        aiCogs: report.contribution.cogs.aiCogs.toString(),
        chainCogs: report.contribution.cogs.chainCogs.toString(),
        infrastructureCogs: report.contribution.cogs.infrastructureCogs.toString(),
      },
    },
  };
}

export function serializeSessionCostReport(report: SessionCostReport) {
  return {
    ...report,
    grossRake: report.grossRake.toString(),
    totalAiCogs: report.totalAiCogs.toString(),
    totalChainCogs: report.totalChainCogs.toString(),
    totalInfrastructureCogs: report.totalInfrastructureCogs.toString(),
    totalCogs: report.totalCogs.toString(),
    protocolContribution: report.protocolContribution.toString(),
    avgAiCogsPerHand: report.avgAiCogsPerHand.toString(),
    avgContributionPerHand: report.avgContributionPerHand.toString(),
    pricing: {
      groq: {
        ...report.pricing.groq,
        inputPerMTok: report.pricing.groq.inputPerMTok.toString(),
        outputPerMTok: report.pricing.groq.outputPerMTok.toString(),
      },
      placeholders: {
        ...report.pricing.placeholders,
        chainGasPerHand: report.pricing.placeholders.chainGasPerHand.toString(),
        vrfPerHand: report.pricing.placeholders.vrfPerHand.toString(),
        relayerPerHand: report.pricing.placeholders.relayerPerHand.toString(),
        cloudPerHand: report.pricing.placeholders.cloudPerHand.toString(),
      },
    },
    handReports: report.handReports.map(serializeHandCostReport),
  };
}
