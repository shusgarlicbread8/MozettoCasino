import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ACTION_TYPE, REASON_CODE, type ActionTypeCode } from "./action-codes.js";
import {
  clampToLegalAmount,
  DeterministicFallbackController,
  DeterministicFallbackProvider,
  FALLBACK_POLICY_ID,
  FALLBACK_POLICY_VERSION,
} from "./deterministic-fallback.js";
import { validateAgainstLegal } from "./decision-schema.js";
import type { DecisionRequest, LegalAction } from "./types.js";

function assertLegalMember(result: { actionType: ActionTypeCode; amount: string }, legal: LegalAction[]) {
  const validated = validateAgainstLegal(
    {
      actionType: result.actionType,
      amount: result.amount,
      publicCadenceMs: 0,
      reasonCode: REASON_CODE.FALLBACK_CHECK,
    },
    legal,
  );
  assert.ok(validated, `action ${result.actionType}@${result.amount} must be legal`);
}

function assertAudit(
  result: {
    fallbackUsed: boolean;
    fallbackPolicyId?: string;
    fallbackPolicyVersion?: number;
    fallbackPriorityStep?: string;
    fallbackSelectionReasonCode?: number;
    reasonCode: number;
  },
  step: string,
  selection: number,
) {
  assert.equal(result.fallbackUsed, true);
  assert.equal(result.fallbackPolicyId, FALLBACK_POLICY_ID);
  assert.equal(result.fallbackPolicyVersion, FALLBACK_POLICY_VERSION);
  assert.equal(result.fallbackPriorityStep, step);
  assert.equal(result.fallbackSelectionReasonCode, selection);
  assert.equal(result.reasonCode, selection);
}

describe("DeterministicFallbackController (WP-076)", () => {
  const fb = () => new DeterministicFallbackController(() => "fixed-nonce");

  describe("HU legal-set shapes", () => {
    it("HU preflop facing raise: fold/call/raise → CALL at min", () => {
      const legal: LegalAction[] = [
        { action: "fold", actionType: ACTION_TYPE.FOLD },
        { action: "call", actionType: ACTION_TYPE.CALL, minAmount: "1500000" },
        { action: "raise", actionType: ACTION_TYPE.RAISE, minAmount: "4500000", maxAmount: "100000000" },
      ];
      const result = fb().decide({ legalActions: legal });
      assert.equal(result.actionType, ACTION_TYPE.CALL);
      assert.equal(result.amount, "1500000");
      assertAudit(result, "CALL", REASON_CODE.FALLBACK_CALL);
      assertLegalMember(result, legal);
    });

    it("HU flop option: check/bet → CHECK", () => {
      const legal: LegalAction[] = [
        { action: "bet", minAmount: "200", maxAmount: "20000" },
        { action: "check" },
      ];
      const result = fb().decide({ legalActions: legal });
      assert.equal(result.actionType, ACTION_TYPE.CHECK);
      assert.equal(result.amount, "0");
      assertAudit(result, "CHECK", REASON_CODE.FALLBACK_CHECK);
      assertLegalMember(result, legal);
    });

    it("HU short-stack shove: fold/call/all_in → CALL", () => {
      const legal: LegalAction[] = [
        { action: "all_in", minAmount: "800", maxAmount: "800" },
        { action: "fold" },
        { action: "call", minAmount: "800", maxAmount: "800" },
      ];
      const result = fb().decide({ legalActions: legal });
      assert.equal(result.actionType, ACTION_TYPE.CALL);
      assert.equal(result.amount, "800");
      assertAudit(result, "CALL", REASON_CODE.FALLBACK_CALL);
      assertLegalMember(result, legal);
    });

    it("HU fold-only (no call) → FOLD", () => {
      const legal: LegalAction[] = [{ action: "fold" }];
      const result = fb().decide({ legalActions: legal });
      assert.equal(result.actionType, ACTION_TYPE.FOLD);
      assert.equal(result.amount, "0");
      assertAudit(result, "FOLD", REASON_CODE.FALLBACK_FOLD);
      assertLegalMember(result, legal);
    });

    it("HU all-in only (no fold/call) → ALL_IN at min", () => {
      const legal: LegalAction[] = [{ action: "all_in", minAmount: "50", maxAmount: "50" }];
      const result = fb().decide({ legalActions: legal });
      assert.equal(result.actionType, ACTION_TYPE.ALL_IN);
      assert.equal(result.amount, "50");
      assertAudit(result, "SIZED_ALL_IN", REASON_CODE.FALLBACK_SIZED);
      assertLegalMember(result, legal);
    });

    it("HU bet-only option → BET at min (not max)", () => {
      const legal: LegalAction[] = [{ action: "bet", minAmount: "100", maxAmount: "5000" }];
      const result = fb().decide({ legalActions: legal });
      assert.equal(result.actionType, ACTION_TYPE.BET);
      assert.equal(result.amount, "100");
      assertAudit(result, "SIZED_BET", REASON_CODE.FALLBACK_SIZED);
      assertLegalMember(result, legal);
    });
  });

  describe("multi / six-max legal-set shapes", () => {
    it("six-max facing bet: fold/call/raise → CALL", () => {
      const legal: LegalAction[] = [
        { action: "raise", actionType: ACTION_TYPE.RAISE, minAmount: "12000000", maxAmount: "90000000" },
        { action: "fold", actionType: ACTION_TYPE.FOLD },
        { action: "call", actionType: ACTION_TYPE.CALL, minAmount: "4000000" },
      ];
      const result = fb().decide({
        legalActions: legal,
        observation: { pot: "9000000", callAmount: "4000000", street: "flop", toActSeat: 3, seat: 3 },
      });
      assert.equal(result.actionType, ACTION_TYPE.CALL);
      assert.equal(result.amount, "4000000");
      assertAudit(result, "CALL", REASON_CODE.FALLBACK_CALL);
      assertLegalMember(result, legal);
    });

    it("multi-way check option mid-street → CHECK over bet", () => {
      const legal: LegalAction[] = [
        { action: "check" },
        { action: "bet", minAmount: "2500000", maxAmount: "80000000" },
      ];
      const result = fb().decide({ legalActions: legal });
      assert.equal(result.actionType, ACTION_TYPE.CHECK);
      assertAudit(result, "CHECK", REASON_CODE.FALLBACK_CHECK);
      assertLegalMember(result, legal);
    });

    it("multi-way fold/raise only (no call — e.g. exact short) → FOLD before raise", () => {
      const legal: LegalAction[] = [
        { action: "raise", minAmount: "6000000", maxAmount: "6000000" },
        { action: "fold" },
      ];
      const result = fb().decide({ legalActions: legal });
      assert.equal(result.actionType, ACTION_TYPE.FOLD);
      assert.equal(result.amount, "0");
      assertAudit(result, "FOLD", REASON_CODE.FALLBACK_FOLD);
      assertLegalMember(result, legal);
    });

    it("multi-way raise+all_in only → RAISE (lower aggression than all-in)", () => {
      const legal: LegalAction[] = [
        { action: "all_in", minAmount: "50000000", maxAmount: "50000000" },
        { action: "raise", minAmount: "9000000", maxAmount: "50000000" },
      ];
      const result = fb().decide({ legalActions: legal });
      assert.equal(result.actionType, ACTION_TYPE.RAISE);
      assert.equal(result.amount, "9000000");
      assertAudit(result, "SIZED_RAISE", REASON_CODE.FALLBACK_SIZED);
      assertLegalMember(result, legal);
    });

    it("multi-way bet+raise+all_in → BET (stable type order, not array order)", () => {
      const legal: LegalAction[] = [
        { action: "all_in", minAmount: "99000000", maxAmount: "99000000" },
        { action: "raise", minAmount: "6000000", maxAmount: "99000000" },
        { action: "bet", minAmount: "2000000", maxAmount: "99000000" },
      ];
      const result = fb().decide({ legalActions: legal });
      assert.equal(result.actionType, ACTION_TYPE.BET);
      assert.equal(result.amount, "2000000");
      assertAudit(result, "SIZED_BET", REASON_CODE.FALLBACK_SIZED);
      assertLegalMember(result, legal);
    });
  });

  describe("determinism + audit invariants", () => {
    it("same legal set → same actionType/amount/reason/priority (nonce aside)", () => {
      const legal: LegalAction[] = [
        { action: "fold" },
        { action: "call", minAmount: "100" },
        { action: "raise", minAmount: "300", maxAmount: "1000" },
      ];
      const a = new DeterministicFallbackController(() => "a").decide({ legalActions: legal });
      const b = new DeterministicFallbackController(() => "b").decide({ legalActions: legal });
      assert.equal(a.actionType, b.actionType);
      assert.equal(a.amount, b.amount);
      assert.equal(a.reasonCode, b.reasonCode);
      assert.equal(a.fallbackPriorityStep, b.fallbackPriorityStep);
      assert.equal(a.fallbackPolicyVersion, b.fallbackPolicyVersion);
      assert.notEqual(a.responseNonce, b.responseNonce);
    });

    it("profile / observation must not change Season 1 selection", () => {
      const legal: LegalAction[] = [
        { action: "fold" },
        { action: "call", minAmount: "999" },
      ];
      const base = fb().decide({ legalActions: legal });
      const shark = fb().decide({
        legalActions: legal,
        profileKey: "shark",
        observation: {
          holeCards: [
            { rank: "A", suit: "s" },
            { rank: "A", suit: "h" },
          ],
          pot: "1",
          callAmount: "999",
          energyRemaining: 100,
        },
      });
      const professor = fb().decide({ legalActions: legal, profileKey: "professor" });
      assert.equal(base.actionType, ACTION_TYPE.CALL);
      assert.equal(shark.actionType, base.actionType);
      assert.equal(shark.amount, base.amount);
      assert.equal(professor.actionType, base.actionType);
      assert.equal(professor.amount, base.amount);
    });

    it("empty legal set → fold + illegal_action marker", () => {
      const result = fb().decide({ legalActions: [] });
      assert.equal(result.actionType, ACTION_TYPE.FOLD);
      assert.equal(result.amount, "0");
      assert.equal(result.errorClass, "illegal_action");
      assertAudit(result, "EMPTY_ILLEGAL", REASON_CODE.FALLBACK_FOLD);
    });

    it("clamps amount when max < min (defensive)", () => {
      assert.equal(
        clampToLegalAmount({ action: "raise", minAmount: "500", maxAmount: "100" }),
        "100",
      );
    });

    it("publicCadenceMs is 0 from fallback; WP-075 clamps/schedules at table clock", () => {
      const result = fb().decide({
        legalActions: [{ action: "check" }],
      });
      assert.equal(result.publicCadenceMs, 0);
    });
  });

  describe("DeterministicFallbackProvider adapter", () => {
    it("exposes v1 model id and returns policy-stamped decisions", async () => {
      const provider = new DeterministicFallbackProvider(
        new DeterministicFallbackController(() => "p"),
      );
      assert.equal(provider.providerId, "deterministic_fallback");
      assert.equal(provider.modelId, "deterministic_fallback_v1");
      const result = await provider.decide({
        legalActions: [{ action: "check" }, { action: "bet", minAmount: "1", maxAmount: "10" }],
      } satisfies DecisionRequest);
      assert.equal(result.actionType, ACTION_TYPE.CHECK);
      assert.equal(result.fallbackPolicyId, FALLBACK_POLICY_ID);
      const bg = await provider.updateState({ kind: "stub" });
      assert.equal(bg.applied, false);
    });
  });
});
