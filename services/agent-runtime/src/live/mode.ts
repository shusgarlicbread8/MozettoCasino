/**
 * WP-107 runtime mode selection.
 *
 * - mock: ProfileMockProvider (CI-safe, no GROQ_API_KEY)
 * - live: GroqGptOss120BProvider (requires GROQ_API_KEY)
 * - auto: live when GROQ_API_KEY is set, else mock
 */

export type AgentRuntimeMode = "mock" | "live" | "auto";
export type ResolvedAgentRuntimeMode = "mock" | "live";

export type CadenceWaitOwner = "client" | "server" | "off";

export function resolveAgentRuntimeMode(
  env: NodeJS.ProcessEnv = process.env,
): ResolvedAgentRuntimeMode {
  const raw = (env.AGENT_RUNTIME_MODE ?? "auto").trim().toLowerCase();
  if (raw === "mock") return "mock";
  if (raw === "live") return "live";
  // auto
  return env.GROQ_API_KEY?.trim() ? "live" : "mock";
}

export function resolveCadenceWaitOwner(
  env: NodeJS.ProcessEnv = process.env,
): CadenceWaitOwner {
  const raw = (env.AGENT_CADENCE_WAIT ?? "client").trim().toLowerCase();
  if (raw === "0" || raw === "off" || raw === "false" || raw === "none") return "off";
  if (raw === "server" || raw === "runtime" || raw === "1" || raw === "true") {
    return "server";
  }
  return "client";
}

/** Soft cap for smoke / harness (ms). 0 = no extra cap beyond WP-075. */
export function resolveCadenceWaitCapMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.AGENT_CADENCE_WAIT_CAP_MS;
  if (raw == null || raw === "") return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0;
}

export function describeRuntimeConfig(env: NodeJS.ProcessEnv = process.env): {
  mode: ResolvedAgentRuntimeMode;
  requestedMode: string;
  hasGroqKey: boolean;
  cadenceWait: CadenceWaitOwner;
  cadenceWaitCapMs: number;
  agentStateStore: string;
  energyLedgerStore: string;
} {
  return {
    mode: resolveAgentRuntimeMode(env),
    requestedMode: (env.AGENT_RUNTIME_MODE ?? "auto").trim() || "auto",
    hasGroqKey: Boolean(env.GROQ_API_KEY?.trim()),
    cadenceWait: resolveCadenceWaitOwner(env),
    cadenceWaitCapMs: resolveCadenceWaitCapMs(env),
    agentStateStore: (env.AGENT_STATE_STORE ?? "memory").trim() || "memory",
    energyLedgerStore: (env.ENERGY_LEDGER_STORE ?? "memory").trim() || "memory",
  };
}
