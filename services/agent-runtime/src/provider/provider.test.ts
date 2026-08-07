import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ACTION_TYPE, REASON_CODE } from "./action-codes.js";
import { DeterministicFallbackController } from "./deterministic-fallback.js";
import {
  CONTROLLER_DECISION_JSON_SCHEMA,
  GroqDecisionOutputSchema,
  validateAgainstLegal,
} from "./decision-schema.js";
import { GroqGptOss120BProvider } from "./groq-gpt-oss-120b.js";
import { CircuitBreaker, computeRetryDelay, shouldRetryHttp } from "./retry.js";
import { SEASON1_MODEL_ID, SEASON1_PROVIDER_ID, SEASON1_TEMPERATURE } from "./season1-policy.js";
import type { DecisionRequest, ProviderSloHooks } from "./types.js";

const legalFacingBet: DecisionRequest = {
  legalActions: [
    { action: "fold", actionType: ACTION_TYPE.FOLD },
    { action: "call", actionType: ACTION_TYPE.CALL, minAmount: "2000000" },
    { action: "raise", actionType: ACTION_TYPE.RAISE, minAmount: "6000000", maxAmount: "100000000" },
  ],
  observation: {
    holeCards: [
      { rank: "A", suit: "s" },
      { rank: "K", suit: "s" },
    ],
    pot: "3000000",
    callAmount: "2000000",
    street: "preflop",
    energyRemaining: 100,
    seat: 0,
  },
  profileKey: "shark",
  skipSchemaRepair: true,
};

function jsonResponse(body: unknown, init?: { status?: number; headers?: Record<string, string> }) {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

function chatContent(decision: unknown) {
  return jsonResponse({
    choices: [{ message: { content: JSON.stringify(decision) } }],
  });
}

describe("decision schema", () => {
  it("strict schema requires all ControllerResponseV1 decision fields", () => {
    assert.deepEqual(CONTROLLER_DECISION_JSON_SCHEMA.required, [
      "actionType",
      "amount",
      "publicCadenceMs",
      "reasonCode",
    ]);
    assert.equal(CONTROLLER_DECISION_JSON_SCHEMA.additionalProperties, false);
  });

  it("rejects illegal actionType against legal list", () => {
    const parsed = GroqDecisionOutputSchema.parse({
      actionType: ACTION_TYPE.CHECK,
      amount: "0",
      publicCadenceMs: 100,
      reasonCode: REASON_CODE.POT_CONTROL,
    });
    assert.equal(validateAgainstLegal(parsed, legalFacingBet.legalActions), null);
  });

  it("accepts raise within bounds", () => {
    const parsed = GroqDecisionOutputSchema.parse({
      actionType: ACTION_TYPE.RAISE,
      amount: "6000000",
      publicCadenceMs: 4200,
      reasonCode: REASON_CODE.PRESSURE_VALUE_MERGE,
    });
    const valid = validateAgainstLegal(parsed, legalFacingBet.legalActions);
    assert.ok(valid);
    assert.equal(valid!.amount, "6000000");
  });
});

describe("DeterministicFallbackController (smoke; see deterministic-fallback.test.ts)", () => {
  it("prefers check when legal and stamps policy audit fields", () => {
    const fb = new DeterministicFallbackController(() => "nonce-1");
    const result = fb.decide({
      legalActions: [
        { action: "check" },
        { action: "bet", minAmount: 10, maxAmount: 100 },
      ],
    });
    assert.equal(result.actionType, ACTION_TYPE.CHECK);
    assert.equal(result.amount, "0");
    assert.equal(result.fallbackUsed, true);
    assert.equal(result.reasonCode, REASON_CODE.FALLBACK_CHECK);
    assert.equal(result.responseNonce, "nonce-1");
    assert.equal(result.fallbackPolicyId, "deterministic-fallback-v1");
    assert.equal(result.fallbackPolicyVersion, 1);
    assert.equal(result.fallbackPriorityStep, "CHECK");
    assert.equal(result.fallbackSelectionReasonCode, REASON_CODE.FALLBACK_CHECK);
  });

  it("prefers call over fold when facing a bet", () => {
    const fb = new DeterministicFallbackController(() => "n2");
    const result = fb.decide(legalFacingBet);
    assert.equal(result.actionType, ACTION_TYPE.CALL);
    assert.equal(result.amount, "2000000");
    assert.equal(result.reasonCode, REASON_CODE.FALLBACK_CALL);
  });

  it("always returns a member of the legal set", () => {
    const fb = new DeterministicFallbackController();
    const actions = [{ action: "all_in" as const, minAmount: "50", maxAmount: "50" }];
    const result = fb.decide({ legalActions: actions });
    assert.equal(result.actionType, ACTION_TYPE.ALL_IN);
    assert.equal(result.amount, "50");
  });
});

describe("retry / circuit helpers", () => {
  it("retries 429 and 5xx", () => {
    assert.equal(shouldRetryHttp(429), true);
    assert.equal(shouldRetryHttp(503), true);
    assert.equal(shouldRetryHttp(400), false);
  });

  it("honors Retry-After seconds", () => {
    const delay = computeRetryDelay({
      attempt: 1,
      statusCode: 429,
      retryAfterHeader: "2",
      baseMs: 250,
    });
    assert.equal(delay, 2000);
  });

  it("opens circuit after threshold failures", () => {
    let now = 1_000;
    const changes: boolean[] = [];
    const breaker = new CircuitBreaker(2, 5_000, () => now, (m) => changes.push(m.open));
    assert.equal(breaker.isOpen(), false);
    breaker.recordFailure();
    assert.equal(breaker.isOpen(), false);
    breaker.recordFailure();
    assert.equal(breaker.isOpen(), true);
    assert.deepEqual(changes, [true]);
    now = 6_001;
    assert.equal(breaker.isOpen(), false);
  });
});

describe("GroqGptOss120BProvider", () => {
  it("pins Season 1 model id and policy hypotheses", () => {
    const provider = new GroqGptOss120BProvider({ apiKey: "test-key" });
    assert.equal(provider.providerId, SEASON1_PROVIDER_ID);
    assert.equal(provider.modelId, SEASON1_MODEL_ID);
    const policy = provider.getModelPolicy();
    assert.equal(policy.modelId, "openai/gpt-oss-120b");
    assert.equal(policy.temperature, SEASON1_TEMPERATURE);
    assert.equal(policy.toolsDisabled, true);
    assert.equal(policy.maxOutputTokens, 256);
    assert.equal(policy.temperatureMilli, 0);
    assert.match(policy.modelPolicyHash, /^0x[0-9a-f]{64}$/i);
    assert.match(policy.masterPolicyHash, /^0x[0-9a-f]{64}$/i);
  });

  it("decide system prompt uses master policy and typed profile axes", async () => {
    let system = "";
    let user = "";
    const fetchImpl: typeof fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      system = body.messages[0].content;
      user = body.messages[1].content;
      return chatContent({
        actionType: ACTION_TYPE.CALL,
        amount: "2000000",
        publicCadenceMs: 100,
        reasonCode: REASON_CODE.DEFAULT_VALUE,
      });
    };
    const provider = new GroqGptOss120BProvider({
      apiKey: "test-key",
      fetchImpl,
      maxAttempts: 1,
      createNonce: () => "n",
    });
    await provider.decide(legalFacingBet);
    assert.match(system, /MOZETTO_CONTROLLER_V1/);
    assert.match(system, /typed axes only/);
    assert.match(system, /"aggression":82/);
    const payload = JSON.parse(user);
    assert.equal(payload.profileKey, "shark");
    assert.equal(payload.profileAxes.aggression, 82);
    assert.match(payload.modelPolicyHash, /^0x[0-9a-f]{64}$/i);
  });

  it("updateState stub kind is a no-op; real kinds use background path", async () => {
    const provider = new GroqGptOss120BProvider({ apiKey: "test-key" });
    const stub = await provider.updateState({ kind: "stub" });
    assert.equal(stub.applied, false);
    assert.match(stub.note, /stub/);

    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  applied: true,
                  streetPlan: { focusTags: ["light"], note: "x" },
                  selfStrategy: null,
                  opponentConfidenceDelta: null,
                  rangeHypotheses: null,
                  timingSamples: null,
                }),
              },
            },
          ],
        }),
        { status: 200 },
      );
    const live = new GroqGptOss120BProvider({ apiKey: "test-key", fetchImpl });
    const bg = await live.updateState({ kind: "light_update", mode: "LIGHT_UPDATE" });
    assert.equal(bg.applied, true);
    assert.ok(bg.statePatch?.streetPlan);
  });

  it("decide returns schema-valid legal raise from mocked Groq HTTP", async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      calls.push(String(init?.method ?? "GET"));
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, SEASON1_MODEL_ID);
      assert.equal(body.temperature, 0);
      assert.equal(body.max_tokens, 256);
      assert.equal(body.response_format?.type, "json_schema");
      assert.equal(body.response_format?.json_schema?.strict, true);
      assert.equal(body.response_format?.json_schema?.name, "controller_decision_v1");
      // Season 1: no tools
      assert.equal(body.tools, undefined);
      return chatContent({
        actionType: ACTION_TYPE.RAISE,
        amount: "6000000",
        publicCadenceMs: 4200,
        reasonCode: REASON_CODE.PRESSURE_VALUE_MERGE,
      });
    };

    const provider = new GroqGptOss120BProvider({
      apiKey: "test-key",
      fetchImpl,
      createNonce: () => "fixed-nonce",
      maxAttempts: 1,
    });

    const result = await provider.decide(legalFacingBet);
    assert.equal(result.fallbackUsed, false);
    assert.equal(result.actionType, ACTION_TYPE.RAISE);
    assert.equal(result.amount, "6000000");
    assert.equal(result.publicCadenceMs, 4200);
    assert.equal(result.reasonCode, REASON_CODE.PRESSURE_VALUE_MERGE);
    assert.equal(result.responseNonce, "fixed-nonce");
    assert.equal(calls.length, 1);
  });

  it("falls back after 429 exhaustion and emits SLO hooks", async () => {
    const events: string[] = [];
    const hooks: ProviderSloHooks = {
      onDecisionStart: () => events.push("start"),
      onRateLimited: () => events.push("rate"),
      onRetry: () => events.push("retry"),
      onDecisionComplete: (m) => events.push(m.fallbackUsed ? "done_fb" : "done_ok"),
    };

    const fetchImpl: typeof fetch = async () =>
      jsonResponse({ error: { message: "rate" } }, { status: 429, headers: { "retry-after": "0" } });

    const provider = new GroqGptOss120BProvider({
      apiKey: "test-key",
      fetchImpl,
      sloHooks: hooks,
      maxAttempts: 2,
      retryBaseMs: 1,
      createNonce: () => "fb",
    });

    const result = await provider.decide(legalFacingBet);
    assert.equal(result.fallbackUsed, true);
    assert.equal(result.actionType, ACTION_TYPE.CALL);
    assert.equal(result.errorClass, "http_429");
    assert.equal(result.reasonCode, REASON_CODE.PROVIDER_ERROR_FALLBACK);
    assert.equal(result.fallbackSelectionReasonCode, REASON_CODE.FALLBACK_CALL);
    assert.equal(result.fallbackPolicyId, "deterministic-fallback-v1");
    assert.equal(result.fallbackPolicyVersion, 1);
    assert.ok(events.includes("start"));
    assert.ok(events.includes("rate"));
    assert.ok(events.includes("done_fb"));
  });

  it("falls back when model returns illegal action and repair skipped", async () => {
    const fetchImpl: typeof fetch = async () =>
      chatContent({
        actionType: ACTION_TYPE.CHECK,
        amount: "0",
        publicCadenceMs: 0,
        reasonCode: 1,
      });

    const provider = new GroqGptOss120BProvider({
      apiKey: "test-key",
      fetchImpl,
      maxAttempts: 1,
      createNonce: () => "x",
    });

    const result = await provider.decide({ ...legalFacingBet, skipSchemaRepair: true });
    assert.equal(result.fallbackUsed, true);
    assert.equal(result.reasonCode, REASON_CODE.ILLEGAL_ACTION_FALLBACK);
    assert.equal(result.fallbackSelectionReasonCode, REASON_CODE.FALLBACK_CALL);
    assert.equal(result.errorClass, "illegal_action");
    assert.equal(result.actionType, ACTION_TYPE.CALL);
  });

  it("schema-repair pass recovers after illegal then legal output", async () => {
    let n = 0;
    const fetchImpl: typeof fetch = async () => {
      n += 1;
      if (n === 1) {
        return chatContent({
          actionType: ACTION_TYPE.CHECK,
          amount: "0",
          publicCadenceMs: 0,
          reasonCode: 1,
        });
      }
      return chatContent({
        actionType: ACTION_TYPE.FOLD,
        amount: "0",
        publicCadenceMs: 500,
        reasonCode: REASON_CODE.DEFAULT_VALUE,
      });
    };

    const provider = new GroqGptOss120BProvider({
      apiKey: "test-key",
      fetchImpl,
      maxAttempts: 1,
      createNonce: () => "rep",
    });

    const result = await provider.decide({ ...legalFacingBet, skipSchemaRepair: false });
    assert.equal(result.fallbackUsed, false);
    assert.equal(result.schemaRepairUsed, true);
    assert.equal(result.actionType, ACTION_TYPE.FOLD);
    assert.equal(result.reasonCode, REASON_CODE.SCHEMA_REPAIR);
    assert.equal(n, 2);
  });

  it("health() reports missing API key without calling network", async () => {
    let called = false;
    const provider = new GroqGptOss120BProvider({
      apiKey: "",
      fetchImpl: async () => {
        called = true;
        return jsonResponse({});
      },
    });
    const health = await provider.health();
    assert.equal(health.ok, false);
    assert.match(health.error ?? "", /GROQ_API_KEY/);
    assert.equal(called, false);
  });

  it("health() ok when models list includes Season 1 model", async () => {
    const provider = new GroqGptOss120BProvider({
      apiKey: "test-key",
      fetchImpl: async () => jsonResponse({ data: [{ id: SEASON1_MODEL_ID }] }),
    });
    const health = await provider.health();
    assert.equal(health.ok, true);
    assert.equal(health.modelId, SEASON1_MODEL_ID);
  });

  it("falls back when API key missing", async () => {
    const prev = process.env.GROQ_API_KEY;
    delete process.env.GROQ_API_KEY;
    try {
      const provider = new GroqGptOss120BProvider({
        fetchImpl: async () => {
          throw new Error("should not fetch");
        },
        createNonce: () => "mk",
      });
      const result = await provider.decide(legalFacingBet);
      assert.equal(result.fallbackUsed, true);
      assert.equal(result.errorClass, "missing_api_key");
    } finally {
      if (prev !== undefined) process.env.GROQ_API_KEY = prev;
    }
  });
});
