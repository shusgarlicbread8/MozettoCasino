import { createHash } from "node:crypto";
import type { HoldemState } from "@mozetto/game-rules";
import { getLegalActions } from "@mozetto/game-rules";
import type { AgentRequest, AgentResponse, PokerAction } from "@mozetto/shared-types";

const AGENT_RUNTIME_URL = process.env.AGENT_RUNTIME_URL ?? "http://localhost:4002";
const SILICONFLOW_API_URL = process.env.SILICONFLOW_API_URL ?? "https://api.siliconflow.cn/v1/chat/completions";
const SILICONFLOW_MODEL = process.env.SILICONFLOW_MODEL ?? "deepseek-ai/DeepSeek-V2.5";

export type SeatDecision = {
  action: PokerAction;
  amount?: number;
  reasonCode: string;
  computeUsed?: number;
  latencyMs?: number;
  fallbackUsed?: boolean;
  modelId?: string;
};

export type SeatControllerContext = {
  state: HoldemState;
  seatIndex: number;
  profileKey: string;
  computeRemainingMs: number;
  sessionId?: string;
  handId?: string | null;
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
    amount: pick?.minAmount,
    reasonCode: "legal_random",
    computeUsed: 5,
    fallbackUsed: true,
  };
}

function buildAgentRequest(ctx: SeatControllerContext): AgentRequest {
  const seat = ctx.state.seats.find((s) => s.seatIndex === ctx.seatIndex)!;
  const callAmount = Math.max(0, ctx.state.currentBet - seat.bet);
  return {
    agentVersion: "1",
    profileKey: (ctx.profileKey as AgentRequest["profileKey"]) ?? "machine",
    game: "holdem",
    legalActions: getLegalActions(ctx.state).map((l) => ({
      action: l.action,
      minAmount: l.minAmount,
      maxAmount: l.maxAmount,
    })),
    privateState: { holeCards: seat.hole ?? [] },
    publicState: {
      board: ctx.state.board,
      pot: ctx.state.pot,
      callAmount,
      street: ctx.state.street,
      stacks: ctx.state.seats.map((s) => s.stack),
      toActSeat: ctx.seatIndex,
    },
    computeRemaining: ctx.computeRemainingMs,
  };
}

/** Calls agent-runtime or falls back to a legal random action. */
export class DeterministicBotController implements SeatController {
  async decide(ctx: SeatControllerContext): Promise<SeatDecision> {
    const legal = getLegalActions(ctx.state);
    if (!legal.length) return { action: "fold", reasonCode: "no_legal", fallbackUsed: true };

    try {
      const res = await fetch(`${AGENT_RUNTIME_URL.replace(/\/$/, "")}/v1/act`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildAgentRequest(ctx)),
        signal: AbortSignal.timeout(Math.min(ctx.computeRemainingMs, 14_000)),
      });
      if (!res.ok) return pickLegalRandom(legal);
      const body = (await res.json()) as AgentResponse & { latencyMs?: number };
      if (!legal.some((l) => l.action === body.action)) return pickLegalRandom(legal);
      return {
        action: body.action,
        amount: body.amount,
        reasonCode: body.reasonCode,
        computeUsed: body.computeUsed,
        latencyMs: body.latencyMs,
        modelId: "agent-runtime",
      };
    } catch {
      return pickLegalRandom(legal);
    }
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
      amount: fb?.minAmount,
      reasonCode: "timeout_fallback",
      computeUsed: 0,
      fallbackUsed: true,
    };
  }
}

/** LLM stub via SiliconFlow; falls back to DeterministicBotController when key missing. */
export class SiliconFlowController implements SeatController {
  private fallback = new DeterministicBotController();

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
      pot: ctx.state.pot,
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
        amount: parsed.amount ?? match.minAmount,
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
  if (process.env.SILICONFLOW_API_KEY && profileKey !== "machine") {
    return new SiliconFlowController();
  }
  return new DeterministicBotController();
}

export const timeoutFallbackController = new TimeoutFallbackController();
