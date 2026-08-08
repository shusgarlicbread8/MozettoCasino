import { createHash } from "node:crypto";
import type { DecisionFacts, HoldemState } from "@mozetto/game-rules";
import { chipsToUsd, getLegalActions } from "@mozetto/game-rules";
import type { AgentRequest, AgentResponse, PokerAction } from "@mozetto/shared-types";

const AGENT_RUNTIME_URL = process.env.AGENT_RUNTIME_URL ?? "http://localhost:4002";
const SILICONFLOW_API_URL = process.env.SILICONFLOW_API_URL ?? "https://api.siliconflow.cn/v1/chat/completions";
const SILICONFLOW_MODEL = process.env.SILICONFLOW_MODEL ?? "deepseek-ai/DeepSeek-V2.5";

/**
 * WP-107 AI seat controller selection:
 * - agent-runtime (default): HTTP → cognition → Energy → Groq/mock → cadence
 * - siliconflow: legacy direct LLM stub
 * - deterministic: legal random / HTTP mock only
 */
export type AiControllerKind = "agent-runtime" | "siliconflow" | "deterministic";

export function resolveAiControllerKind(
  env: NodeJS.ProcessEnv = process.env,
): AiControllerKind {
  const raw = (env.AI_CONTROLLER ?? "agent-runtime").trim().toLowerCase();
  if (raw === "siliconflow" || raw === "sf") return "siliconflow";
  if (raw === "deterministic" || raw === "bot" || raw === "random") return "deterministic";
  return "agent-runtime";
}

export type SeatDecision = {
  action: PokerAction;
  amount?: number;
  reasonCode: string;
  computeUsed?: number;
  latencyMs?: number;
  providerLatencyMs?: number;
  publicCadenceMs?: number;
  cadenceWaitMs?: number;
  cadenceSleptMs?: number;
  fallbackUsed?: boolean;
  energyDebited?: number;
  energyRemaining?: number;
  modelId?: string;
};

export type SeatControllerContext = {
  state: HoldemState;
  seatIndex: number;
  profileKey: string;
  computeRemainingMs: number;
  sessionId?: string;
  handId?: string | null;
  /**
   * Deterministic decision facts (pot odds, SPR, range, equity-vs-range,
   * candidate sizings). Supplied so the model never has to derive them.
   */
  facts?: DecisionFacts;
};

export interface SeatController {
  decide(ctx: SeatControllerContext): Promise<SeatDecision>;
}

function pickLegalRandom(legal: ReturnType<typeof getLegalActions>): SeatDecision {
  const fold = legal.find((l) => l.action === "fold");
  const check = legal.find((l) => l.action === "check");
  const pick = legal[Math.floor(Math.random() * legal.length)] ?? fold ?? check ?? legal[0];
  return {
    action: pick?.action ?? "fold",
    amount: pick?.minAmount != null ? chipsToUsd(pick.minAmount) : undefined,
    reasonCode: "legal_random",
    computeUsed: 5,
    fallbackUsed: true,
  };
}

function buildAgentRequest(ctx: SeatControllerContext): AgentRequest & {
  sessionId?: string;
  handId?: string;
  seatIndex?: number;
  cadenceWait?: "client" | "server" | "off";
  facts?: DecisionFacts;
} {
  const seat = ctx.state.seats.find((s) => s.seatIndex === ctx.seatIndex)!;
  const toCallChips = ctx.state.currentBet > seat.bet ? ctx.state.currentBet - seat.bet : 0n;
  const callAmount = chipsToUsd(toCallChips);
  return {
    agentVersion: "1",
    profileKey: (ctx.profileKey as AgentRequest["profileKey"]) ?? "machine",
    game: "holdem",
    legalActions: getLegalActions(ctx.state).map((l) => ({
      action: l.action,
      minAmount: l.minAmount != null ? chipsToUsd(l.minAmount) : undefined,
      maxAmount: l.maxAmount != null ? chipsToUsd(l.maxAmount) : undefined,
    })),
    privateState: { holeCards: seat.hole ?? [] },
    publicState: {
      board: ctx.state.board,
      pot: chipsToUsd(ctx.state.pot),
      callAmount,
      street: ctx.state.street,
      stacks: ctx.state.seats.map((s) => chipsToUsd(s.stack)),
      toActSeat: ctx.seatIndex,
    },
    computeRemaining: ctx.computeRemainingMs,
    facts: ctx.facts,
    sessionId: ctx.sessionId,
    handId: ctx.handId ?? undefined,
    seatIndex: ctx.seatIndex,
    // Game-server owns table-clock wait (WP-075 client mode).
    cadenceWait: "client",
  };
}

type AgentRuntimeActResponse = AgentResponse & {
  latencyMs?: number;
  providerLatencyMs?: number;
  publicCadenceMs?: number;
  cadenceWaitMs?: number;
  cadenceSleptMs?: number;
  fallbackUsed?: boolean;
  energyDebited?: number;
  energyRemaining?: number;
  modelId?: string;
};

/**
 * WP-107: calls agent-runtime `/v1/act` (cognition + Energy + Groq/mock + cadence schedule).
 * Falls back to a legal random action on transport / legality failure.
 */
export class AgentRuntimeController implements SeatController {
  async decide(ctx: SeatControllerContext): Promise<SeatDecision> {
    const legal = getLegalActions(ctx.state);
    if (!legal.length) return { action: "fold", reasonCode: "no_legal", fallbackUsed: true };

    const started = Date.now();
    try {
      const res = await fetch(`${AGENT_RUNTIME_URL.replace(/\/$/, "")}/v1/act`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildAgentRequest(ctx)),
        // Preserve room to commit inside the product's 12s maximum visible cadence.
        signal: AbortSignal.timeout(Math.min(ctx.computeRemainingMs, 10_500)),
      });
      if (!res.ok) {
        return { ...pickLegalRandom(legal), providerLatencyMs: Date.now() - started };
      }
      const body = (await res.json()) as AgentRuntimeActResponse;
      if (!legal.some((l) => l.action === body.action)) {
        return {
          ...pickLegalRandom(legal),
          reasonCode: "illegal_retry_random",
          providerLatencyMs: Date.now() - started,
        };
      }
      return {
        action: body.action,
        amount: body.amount,
        reasonCode: body.reasonCode,
        computeUsed: body.computeUsed,
        latencyMs: body.latencyMs,
        providerLatencyMs: body.providerLatencyMs,
        publicCadenceMs: body.publicCadenceMs,
        cadenceWaitMs: body.cadenceWaitMs,
        cadenceSleptMs: body.cadenceSleptMs,
        fallbackUsed: body.fallbackUsed ?? false,
        energyDebited: body.energyDebited,
        energyRemaining: body.energyRemaining,
        modelId: body.modelId ?? "agent-runtime",
      };
    } catch {
      return { ...pickLegalRandom(legal), providerLatencyMs: Date.now() - started };
    }
  }
}

/** @deprecated Prefer AgentRuntimeController — kept for AI_CONTROLLER=deterministic. */
export class DeterministicBotController implements SeatController {
  private inner = new AgentRuntimeController();

  async decide(ctx: SeatControllerContext): Promise<SeatDecision> {
    // Still hit agent-runtime when available; random only on failure.
    return this.inner.decide(ctx);
  }
}

/** Fold-first timeout policy for disconnected / clock-expired seats. */
export class TimeoutFallbackController implements SeatController {
  async decide(ctx: SeatControllerContext): Promise<SeatDecision> {
    const legal = getLegalActions(ctx.state);
    const fold = legal.find((l) => l.action === "fold");
    const check = legal.find((l) => l.action === "check");
    const fb = fold ?? check ?? legal[0];
    return {
      action: fb?.action ?? "fold",
      amount: fb?.minAmount != null ? chipsToUsd(fb.minAmount) : undefined,
      reasonCode: "timeout_fallback",
      computeUsed: 0,
      fallbackUsed: true,
    };
  }
}

/** LLM stub via SiliconFlow; falls back to AgentRuntimeController when key missing. */
export class SiliconFlowController implements SeatController {
  private fallback = new AgentRuntimeController();

  async decide(ctx: SeatControllerContext): Promise<SeatDecision> {
    const apiKey = process.env.SILICONFLOW_API_KEY;
    const legal = getLegalActions(ctx.state);
    if (!apiKey || !legal.length) {
      const fb = await this.fallback.decide(ctx);
      return { ...fb, fallbackUsed: true, modelId: SILICONFLOW_MODEL };
    }

    const seat = ctx.state.seats.find((s) => s.seatIndex === ctx.seatIndex)!;
    const prompt = {
      profile: ctx.profileKey,
      street: ctx.state.street,
      pot: chipsToUsd(ctx.state.pot),
      board: ctx.state.board,
      hole: seat.hole,
      legal: legal.map((l) => l.action),
    };

    try {
      const started = Date.now();
      const res = await fetch(SILICONFLOW_API_URL, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: SILICONFLOW_MODEL,
          messages: [
            {
              role: "system",
              content: "Reply JSON only: {\"action\":\"fold|check|call|bet|raise|all_in\",\"amount\":number|null}",
            },
            { role: "user", content: JSON.stringify(prompt) },
          ],
          temperature: 0.2,
          max_tokens: 64,
        }),
        signal: AbortSignal.timeout(Math.min(ctx.computeRemainingMs, 12_000)),
      });
      if (!res.ok) return this.fallback.decide(ctx);
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const raw = data.choices?.[0]?.message?.content ?? "";
      const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? "{}") as { action?: PokerAction; amount?: number };
      const match = legal.find((l) => l.action === parsed.action);
      if (!match) return this.fallback.decide(ctx);
      return {
        action: match.action,
        amount:
          parsed.amount ??
          (match.minAmount != null ? chipsToUsd(match.minAmount) : undefined),
        reasonCode: "siliconflow",
        computeUsed: Date.now() - started,
        latencyMs: Date.now() - started,
        modelId: SILICONFLOW_MODEL,
      };
    } catch {
      return this.fallback.decide(ctx);
    }
  }
}

export function hashObservation(ctx: SeatControllerContext): string {
  const seat = ctx.state.seats.find((s) => s.seatIndex === ctx.seatIndex);
  return createHash("sha256")
    .update(
      JSON.stringify({
        handId: ctx.handId,
        seatIndex: ctx.seatIndex,
        street: ctx.state.street,
        pot: ctx.state.pot,
        board: ctx.state.board,
        hole: seat?.hole,
        legal: getLegalActions(ctx.state).map((l) => l.action),
      }),
    )
    .digest("hex");
}

export function resolveSeatController(profileKey: string): SeatController {
  const kind = resolveAiControllerKind();
  if (kind === "siliconflow") {
    return new SiliconFlowController();
  }
  // Legacy: SiliconFlow key + non-machine profile without explicit AI_CONTROLLER.
  if (
    !process.env.AI_CONTROLLER &&
    process.env.SILICONFLOW_API_KEY &&
    profileKey !== "machine"
  ) {
    return new SiliconFlowController();
  }
  return new AgentRuntimeController();
}

/** WP-126 owner-safe cognition status from agent-runtime observe. */
export type PublicAiCognitionStatusWire = {
  workPacket?: "WP-126";
  seat: number;
  handId: string;
  sessionId: string;
  phase:
    | "OBSERVING"
    | "ANALYSING"
    | "UPDATING_OPPONENT_MODEL"
    | "DECISION_READY"
    | "ACTING";
  energyRemaining: number | null;
  energyPerHand?: number;
  publicCadenceMs?: number | null;
  signalSource?: string;
  atMs?: number;
};

/**
 * Notify agent-runtime of a public table event for continuous cognition.
 * Never sends hole cards / CoT. Returns WP-126 public seat statuses when available.
 */
export async function notifyAgentRuntimeObserve(input: {
  sessionId: string;
  handId: string;
  seats: number[];
  profiles?: Record<string, string>;
  event: {
    cursor: number;
    eventId?: string;
    eventType: string;
    street?: string;
    actorSeat?: number | null;
    amount?: number | string | null;
    pot?: number | string | null;
    /** WP-111 — hand rake on HAND_SETTLED. */
    rake?: number | string | null;
    stacksBySeat?: Record<string, number | string>;
    activeSeats?: number[];
    boardCardCount?: number;
    summaryCode?: string;
  };
}): Promise<PublicAiCognitionStatusWire[]> {
  if (process.env.AGENT_RUNTIME_OBSERVE === "0") return [];
  if (!input.seats.length || !input.sessionId || !input.handId) return [];
  try {
    const res = await fetch(`${AGENT_RUNTIME_URL.replace(/\/$/, "")}/v1/observe`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(2_500),
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { seats?: PublicAiCognitionStatusWire[] };
    return Array.isArray(body.seats) ? body.seats : [];
  } catch (err) {
    console.warn("[wp-107] agent-runtime observe failed", err);
    return [];
  }
}

export async function notifyAgentRuntimeHandBegin(input: {
  sessionId: string;
  handId: string;
  seats: Array<{ seat: number; profileKey?: string }>;
}): Promise<void> {
  if (process.env.AGENT_RUNTIME_OBSERVE === "0") return;
  try {
    await fetch(`${AGENT_RUNTIME_URL.replace(/\/$/, "")}/v1/hand/begin`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(2_500),
    });
  } catch (err) {
    console.warn("[wp-107] agent-runtime hand/begin failed", err);
  }
}

/** WP-111 — close hand COGS ledger with rake contribution. */
export async function notifyAgentRuntimeHandEnd(input: {
  sessionId: string;
  handId: string;
  rakeRevenue?: number | string | null;
}): Promise<void> {
  if (process.env.AGENT_RUNTIME_OBSERVE === "0") return;
  if (!input.sessionId || !input.handId) return;
  try {
    await fetch(`${AGENT_RUNTIME_URL.replace(/\/$/, "")}/v1/hand/end`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(2_500),
    });
  } catch (err) {
    console.warn("[wp-111] agent-runtime hand/end failed", err);
  }
}

export const timeoutFallbackController = new TimeoutFallbackController();
