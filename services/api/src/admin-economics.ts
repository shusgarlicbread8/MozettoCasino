/**
 * WP-111 — admin economics / contribution-margin snapshot.
 *
 * Pulls live agent-runtime COGS metrics when available and merges with
 * Plan 11 revenue transparency. Never freezes Season 1 rake into GameTemplates.
 */

import {
  SEASON1_RAKE_SCHEDULE,
  SEASON1_SCHEDULE_STATUS,
  SEASON1_GROQ_TOKEN_PRICING_USD_MICRO_PER_MTOK,
  SEASON1_CHAIN_INFRA_PLACEHOLDERS_USD_MICRO,
  buildRevenueTransparencyReport,
  serializeRevenueReport,
  placeholdersFromEnv,
} from "@mozetto/unit-economics";
import { buildTreasuryRevenueSnapshot } from "./admin-treasury.js";

function agentRuntimeBase(): string {
  return (
    process.env.AGENT_RUNTIME_URL ||
    process.env.AGENT_URL ||
    "http://localhost:4002"
  ).replace(/\/$/, "");
}

async function fetchAgentEconomics(): Promise<{
  ok: boolean;
  status?: number;
  body?: unknown;
  error?: string;
}> {
  const url = `${agentRuntimeBase()}/v1/economics`;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(3_000),
    });
    const body = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, body };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

function asBigInt(v: unknown): bigint | null {
  if (v == null) return null;
  try {
    return BigInt(String(v));
  } catch {
    return null;
  }
}

export async function buildEconomicsInstrumentationSnapshot(opts?: {
  chainId?: number;
}) {
  const [treasury, agent] = await Promise.all([
    buildTreasuryRevenueSnapshot({ chainId: opts?.chainId }),
    fetchAgentEconomics(),
  ]);

  const agentBody = (agent.body ?? null) as Record<string, unknown> | null;
  const sessionReport =
    agentBody && typeof agentBody === "object"
      ? ((agentBody.sessionReport as Record<string, unknown> | null) ?? null)
      : null;

  const aiCogs =
    asBigInt(sessionReport?.totalAiCogs) ??
    asBigInt(agentBody?.aiCogsUsdMicro);
  const chainCogs = asBigInt(sessionReport?.totalChainCogs);
  const infrastructureCogs = asBigInt(sessionReport?.totalInfrastructureCogs);

  const cogsComplete =
    aiCogs != null && chainCogs != null && infrastructureCogs != null;

  // Rebuild contribution when live COGS are present (treasury alone leaves COGS null).
  const revenueWithCogs = cogsComplete
    ? serializeRevenueReport(
        buildRevenueTransparencyReport({
          grossRake: BigInt(treasury.revenue.grossRake),
          rakeRefunds: 0n,
          feeVaultAccrued:
            treasury.revenue.feeVaultAccrued != null
              ? BigInt(treasury.revenue.feeVaultAccrued)
              : null,
          treasurySwept:
            treasury.revenue.treasurySweep != null
              ? BigInt(treasury.revenue.treasurySweep)
              : null,
          lockedPlayerFunds: BigInt(treasury.revenue.lockedPlayerFunds),
          cogs: {
            aiCogs: aiCogs!,
            chainCogs: chainCogs!,
            infrastructureCogs: infrastructureCogs!,
          },
          scope: {
            periodRoot: null,
            sessionRange: "agent-runtime closed hands + settlement_proposals",
            league: null,
          },
        }),
      )
    : treasury.revenue;

  const placeholders = placeholdersFromEnv();

  return {
    readOnly: true as const,
    workPacket: "WP-111" as const,
    generatedAt: new Date().toISOString(),
    scheduleStatus: SEASON1_SCHEDULE_STATUS,
    season1FeePolicy: "poker_rake_only" as const,
    freezeWarning:
      "Season 1 rake schedule and COGS rates are hypotheses — do not silently freeze into GameTemplates.",
    season1Schedule: {
      status: SEASON1_SCHEDULE_STATUS,
      rows: SEASON1_RAKE_SCHEDULE,
      note: "Hypotheses for simulation — not automatic mainnet GameTemplate values.",
    },
    pricingHypotheses: {
      status: "hypothesis" as const,
      groq: {
        ...SEASON1_GROQ_TOKEN_PRICING_USD_MICRO_PER_MTOK,
        inputPerMTok: SEASON1_GROQ_TOKEN_PRICING_USD_MICRO_PER_MTOK.inputPerMTok.toString(),
        outputPerMTok: SEASON1_GROQ_TOKEN_PRICING_USD_MICRO_PER_MTOK.outputPerMTok.toString(),
      },
      placeholders: {
        ...SEASON1_CHAIN_INFRA_PLACEHOLDERS_USD_MICRO,
        chainGasPerHand: (
          placeholders.chainGasPerHand ??
          SEASON1_CHAIN_INFRA_PLACEHOLDERS_USD_MICRO.chainGasPerHand
        ).toString(),
        vrfPerHand: (
          placeholders.vrfPerHand ?? SEASON1_CHAIN_INFRA_PLACEHOLDERS_USD_MICRO.vrfPerHand
        ).toString(),
        relayerPerHand: (
          placeholders.relayerPerHand ??
          SEASON1_CHAIN_INFRA_PLACEHOLDERS_USD_MICRO.relayerPerHand
        ).toString(),
        cloudPerHand: (
          placeholders.cloudPerHand ?? SEASON1_CHAIN_INFRA_PLACEHOLDERS_USD_MICRO.cloudPerHand
        ).toString(),
      },
    },
    agentRuntime: {
      url: agentRuntimeBase(),
      reachable: agent.ok,
      status: agent.status ?? null,
      error: agent.error ?? null,
      economics: agent.ok ? agentBody : null,
    },
    cogsInstrumented: cogsComplete,
    revenue: revenueWithCogs,
    treasury,
    cli: {
      demo: "pnpm economics:report -- --demo",
      ledger: "pnpm economics:report -- --ledger <path.jsonl>",
      envOverrides: [
        "COGS_CHAIN_GAS_USD_MICRO",
        "COGS_VRF_USD_MICRO",
        "COGS_RELAYER_USD_MICRO",
        "COGS_CLOUD_USD_MICRO",
        "ECONOMICS_LEDGER_PATH",
      ],
    },
    notes: [
      "AI COGS from Groq token usage × hypothesis rates when agent-runtime reports usage.",
      "Chain/VRF/relayer/cloud are amortized placeholders until Sepolia calibration.",
      "Contribution margin = net rake − AI − chain − infra (Plan 11).",
    ],
  };
}
