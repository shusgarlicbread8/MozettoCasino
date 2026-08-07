import Fastify from "fastify";
import cors from "@fastify/cors";
import { AgentRequestSchema, type AgentResponse } from "@mozetto/shared-types";

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });

function decide(req: ReturnType<typeof AgentRequestSchema.parse>): AgentResponse {
  const { profileKey, legalActions, publicState, privateState } = req;
  const has = (a: string) => legalActions.find((x) => x.action === a);
  const suited =
    privateState.holeCards.length === 2 &&
    privateState.holeCards[0].suit === privateState.holeCards[1].suit;
  const high =
    privateState.holeCards.some((c) => ["A", "K", "Q"].includes(c.rank));

  // Profile-biased but always legal
  if (profileKey === "shark") {
    if (has("raise") && (high || suited)) {
      const r = has("raise")!;
      return { action: "raise", amount: r.minAmount, reasonCode: "pressure", computeUsed: 120 };
    }
    if (has("bet") && publicState.pot > 0) {
      const b = has("bet")!;
      return { action: "bet", amount: b.minAmount, reasonCode: "cbet", computeUsed: 100 };
    }
  }
  if (profileKey === "professor") {
    if (has("check")) return { action: "check", reasonCode: "pot_control", computeUsed: 80 };
    if (has("call") && publicState.callAmount <= publicState.pot * 0.35) {
      return { action: "call", amount: has("call")!.minAmount, reasonCode: "odds", computeUsed: 140 };
    }
  }
  if (profileKey === "fox") {
    if (has("raise") && suited) {
      return { action: "raise", amount: has("raise")!.minAmount, reasonCode: "semi_bluff", computeUsed: 160 };
    }
    if (has("bet")) return { action: "bet", amount: has("bet")!.minAmount, reasonCode: "probe", computeUsed: 110 };
  }
  if (profileKey === "machine") {
    if (has("check")) return { action: "check", reasonCode: "default", computeUsed: 40 };
    if (has("call")) return { action: "call", amount: has("call")!.minAmount, reasonCode: "default", computeUsed: 40 };
  }

  if (has("check")) return { action: "check", reasonCode: "fallback_check", computeUsed: 20 };
  if (has("call")) return { action: "call", amount: has("call")!.minAmount, reasonCode: "fallback_call", computeUsed: 20 };
  if (has("fold")) return { action: "fold", reasonCode: "fallback_fold", computeUsed: 10 };
  const first = legalActions[0];
  return { action: first.action, amount: first.minAmount, reasonCode: "fallback", computeUsed: 10 };
}

app.post("/v1/act", async (req, reply) => {
  const parsed = AgentRequestSchema.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

  const started = Date.now();
  const budget = Math.min(Math.max(parsed.data.computeRemaining ?? 15_000, 1_000), 15_000);
  try {
    // Lightweight bots decide quickly, but respect the table's turn budget.
    const thinkMs = 400 + Math.floor(Math.random() * 900);
    await new Promise((r) => setTimeout(r, Math.min(thinkMs, budget - 200)));
    const result = await Promise.race([
      Promise.resolve(decide(parsed.data)),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), budget)),
    ]);
    // validate legal
    const legal = parsed.data.legalActions.find((l) => l.action === result.action);
    if (!legal) {
      const fold = parsed.data.legalActions.find((l) => l.action === "fold");
      const check = parsed.data.legalActions.find((l) => l.action === "check");
      return {
        action: (fold ?? check ?? parsed.data.legalActions[0]).action,
        amount: (fold ?? check ?? parsed.data.legalActions[0]).minAmount,
        reasonCode: "invalid_retry_fold",
        computeUsed: result.computeUsed,
        latencyMs: Date.now() - started,
      };
    }
    return { ...result, latencyMs: Date.now() - started };
  } catch {
    const fold = parsed.data.legalActions.find((l) => l.action === "fold");
    const check = parsed.data.legalActions.find((l) => l.action === "check");
    const fb = fold ?? check ?? parsed.data.legalActions[0];
    return {
      action: fb.action,
      amount: fb.minAmount,
      reasonCode: "timeout_fold",
      computeUsed: 0,
      latencyMs: Date.now() - started,
    };
  }
});

app.get("/health", async () => ({ ok: true }));

const port = Number(process.env.PORT ?? process.env.AGENT_PORT ?? 4002);
await app.listen({ port, host: "0.0.0.0" });
