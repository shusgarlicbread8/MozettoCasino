/**
 * WP-077 offline poker evaluation harness runner.
 *
 * Default mode: ProfileMockProvider (CI-safe, no GROQ_API_KEY).
 * Optional live: GroqGptOss120BProvider when GROQ_API_KEY is set.
 */

import { keccak256, toBytes, type Hex } from "viem";
import {
  EnergyOperationType,
  debitEnergy,
  expireUnusedEnergy,
  grantHandEnergy,
} from "../energy/index.js";
import { ACTION_NAME_BY_TYPE } from "../provider/action-codes.js";
import { GroqGptOss120BProvider } from "../provider/groq-gpt-oss-120b.js";
import type { DecisionRequest, PokerModelProvider } from "../provider/types.js";
import type { PresetKey } from "../policy/presets.js";
import { ProfileMockProvider, type MockProviderOptions } from "./mock-provider.js";
import {
  buildReport,
  classifyDecision,
  scoreEvStub,
  type DecisionSample,
  type EvalReport,
} from "./metrics.js";
import {
  DEFAULT_PRESETS,
  EVAL_SCENARIOS,
  scenarioToRequest,
  type EvalScenario,
} from "./scenarios.js";

const ZERO32 =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex;

export type EvalMode = "mock" | "live";

export interface HarnessOptions {
  mode?: EvalMode;
  /** Decisions per profile (distributed across scenarios). Default 28 (4×7). */
  decisionsPerProfile?: number;
  presets?: readonly PresetKey[];
  scenarios?: readonly EvalScenario[];
  seed?: string;
  /** Inject provider faults in mock mode (default 0). */
  faultRate?: number;
  mock?: MockProviderOptions;
  /** Injected provider (tests). */
  providerFactory?: (profileKey: PresetKey) => PokerModelProvider;
  /** Track Energy via WP-074 ledger (default true). */
  trackEnergy?: boolean;
  separationThreshold?: number;
  /** Live mode requires GROQ_API_KEY unless a factory is injected. */
  requireLiveKey?: boolean;
}

function handIdHex(label: string): Hex {
  return keccak256(toBytes(label));
}

function sessionIdHex(profile: PresetKey): Hex {
  return keccak256(toBytes(`wp077-session-${profile}`));
}

function createProvider(
  mode: EvalMode,
  opts: HarnessOptions,
): PokerModelProvider {
  if (opts.providerFactory) {
    // Factory still called per profile in run — this is unused in that path.
    return opts.providerFactory("machine");
  }
  if (mode === "live") {
    const key = process.env.GROQ_API_KEY;
    if (!key && opts.requireLiveKey !== false) {
      throw new Error(
        "WP-077 live mode requires GROQ_API_KEY (use --mode mock for CI)",
      );
    }
    return new GroqGptOss120BProvider({
      apiKey: key,
      createNonce: () => `live-${Date.now()}`,
    });
  }
  return new ProfileMockProvider({
    seed: opts.seed ?? "wp-077-mock",
    faultRate: opts.faultRate ?? opts.mock?.faultRate ?? 0,
    ...opts.mock,
  });
}

/**
 * Run offline (or optional live) evaluation across presets × scenarios.
 */
export async function runPokerEvalHarness(
  opts: HarnessOptions = {},
): Promise<EvalReport> {
  const mode: EvalMode = opts.mode ?? "mock";
  const seed = opts.seed ?? "wp-077-mock";
  const presets = opts.presets ?? DEFAULT_PRESETS;
  const scenarios = opts.scenarios ?? EVAL_SCENARIOS;
  const decisionsPerProfile = opts.decisionsPerProfile ?? scenarios.length * 4;
  const trackEnergy = opts.trackEnergy !== false;
  const startedAt = new Date().toISOString();
  const samples: DecisionSample[] = [];
  const notes: string[] = [
    "bb/100 is a rough EV stub from scenario weights — not full session equity.",
    "Default mode uses ProfileMockProvider (no live Groq).",
  ];

  if (mode === "live") {
    notes.push("Live Groq mode — results depend on network and model policy.");
  }

  for (const profileKey of presets) {
    const provider = opts.providerFactory
      ? opts.providerFactory(profileKey)
      : createProvider(mode, opts);

    const profile = ProfileMockProvider.profileFor(profileKey);
    let ledger = trackEnergy
      ? grantHandEnergy({
          sessionId: sessionIdHex(profileKey),
          handId: handIdHex(`${profileKey}-hand-0`),
          seat: 0,
        })
      : null;
    let handCounter = 0;
    let decisionsInHand = 0;

    for (let i = 0; i < decisionsPerProfile; i++) {
      const scenario = scenarios[i % scenarios.length]!;
      // New hand Energy grant every scenario.length decisions
      if (trackEnergy && decisionsInHand >= scenarios.length) {
        ledger = expireUnusedEnergy(ledger!);
        handCounter += 1;
        ledger = grantHandEnergy({
          sessionId: sessionIdHex(profileKey),
          handId: handIdHex(`${profileKey}-hand-${handCounter}`),
          seat: 0,
        });
        decisionsInHand = 0;
      }

      const request: DecisionRequest = {
        ...scenarioToRequest(scenario, profileKey),
        profile,
        observation: {
          ...scenario.observation,
          energyRemaining: ledger?.remainingEnergy ?? scenario.observation.energyRemaining,
          handId: scenario.id,
          sessionId: `eval-${profileKey}`,
        },
      };

      const result = await provider.decide(request);
      const latency = result.providerLatencyMs ?? 0;
      const classified = classifyDecision(scenario, result);

      let energyDebited = 0;
      if (trackEnergy && ledger) {
        const debit = debitEnergy(ledger, {
          operationType: EnergyOperationType.STANDARD_FINAL_DECISION,
          observationHash: handIdHex(`${scenario.id}:${i}`),
          resultHash: handIdHex(`${result.actionType}:${result.amount}:${result.responseNonce}`),
          providerRequestId: ZERO32,
          fallbackFlag: result.fallbackUsed,
          executed: true,
          spendClass: "final",
        });
        if (debit.ok) {
          ledger = debit.ledger;
          const last = ledger.ops[ledger.ops.length - 1];
          energyDebited = last?.energyDebit ?? 0;
        }
      }

      samples.push({
        profileKey,
        scenarioId: scenario.id,
        street: scenario.observation.street ?? "unknown",
        actionType: result.actionType,
        actionName: ACTION_NAME_BY_TYPE[result.actionType],
        amount: result.amount,
        fallbackUsed: result.fallbackUsed,
        illegalActionFallback: classified.illegalActionFallback,
        providerLatencyMs: latency,
        energyDebited,
        evStubBb: scoreEvStub(scenario, result.actionType),
        errorClass: result.errorClass,
        voluntaryPutMoney: classified.voluntaryPutMoney,
        preflopRaise: classified.preflopRaise,
        aggressive: classified.aggressive,
      });
      decisionsInHand += 1;
    }

    if (trackEnergy && ledger && ledger.status === "open") {
      expireUnusedEnergy(ledger);
    }
  }

  const finishedAt = new Date().toISOString();
  return buildReport({
    mode,
    seed,
    startedAt,
    finishedAt,
    samples,
    notes,
    separationThreshold: opts.separationThreshold,
  });
}

/** Compact smoke run for unit tests (few decisions, mock only). */
export async function runEvalSmoke(overrides?: Partial<HarnessOptions>): Promise<EvalReport> {
  return runPokerEvalHarness({
    mode: "mock",
    decisionsPerProfile: EVAL_SCENARIOS.length,
    seed: "wp-077-smoke",
    ...overrides,
  });
}
