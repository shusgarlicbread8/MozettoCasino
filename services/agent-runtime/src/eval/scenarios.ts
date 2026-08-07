/**
 * Offline decision scenarios for WP-077 poker evaluation harness.
 * Legal sets mirror CONTROLLER_V1 action types; not full engine replay.
 */

import { ACTION_TYPE } from "../provider/action-codes.js";
import type { DecisionRequest, LegalAction } from "../provider/types.js";
import type { PresetKey } from "../policy/presets.js";

export type ScenarioKind =
  | "hu_preflop_open"
  | "hu_preflop_facing_raise"
  | "hu_flop_check"
  | "hu_flop_facing_bet"
  | "hu_turn_probe"
  | "multi_preflop_utg"
  | "multi_flop_multiway";

export interface EvalScenario {
  id: string;
  kind: ScenarioKind;
  /** Big blind in chips (for bb/100 stub). */
  bigBlind: number;
  legalActions: LegalAction[];
  observation: NonNullable<DecisionRequest["observation"]>;
  /** Rough EV stub weights used when scoring actions (chips relative to BB). */
  evStubBb: Partial<Record<"fold" | "check" | "call" | "bet" | "raise" | "all_in", number>>;
}

const BB = 2_000_000;

export const EVAL_SCENARIOS: readonly EvalScenario[] = [
  {
    id: "hu_01_preflop_bb_option",
    kind: "hu_preflop_open",
    bigBlind: BB,
    legalActions: [
      { action: "check", actionType: ACTION_TYPE.CHECK },
      { action: "bet", actionType: ACTION_TYPE.BET, minAmount: String(BB), maxAmount: String(100 * BB) },
      { action: "all_in", actionType: ACTION_TYPE.ALL_IN, minAmount: String(100 * BB), maxAmount: String(100 * BB) },
    ],
    observation: {
      holeCards: [
        { rank: "A", suit: "s" },
        { rank: "K", suit: "s" },
      ],
      pot: String(3 * BB),
      callAmount: "0",
      street: "preflop",
      stacks: [String(100 * BB), String(100 * BB)],
      toActSeat: 1,
      energyRemaining: 100,
      seat: 1,
    },
    evStubBb: { check: 0, bet: 0.15, all_in: -0.4 },
  },
  {
    id: "hu_02_preflop_facing_open",
    kind: "hu_preflop_facing_raise",
    bigBlind: BB,
    legalActions: [
      { action: "fold", actionType: ACTION_TYPE.FOLD },
      { action: "call", actionType: ACTION_TYPE.CALL, minAmount: String(2 * BB), maxAmount: String(2 * BB) },
      {
        action: "raise",
        actionType: ACTION_TYPE.RAISE,
        minAmount: String(6 * BB),
        maxAmount: String(100 * BB),
      },
    ],
    observation: {
      holeCards: [
        { rank: "Q", suit: "h" },
        { rank: "Q", suit: "d" },
      ],
      pot: String(3 * BB),
      callAmount: String(2 * BB),
      street: "preflop",
      stacks: [String(98 * BB), String(100 * BB)],
      toActSeat: 0,
      energyRemaining: 100,
      seat: 0,
    },
    evStubBb: { fold: -0.5, call: 0.05, raise: 0.25 },
  },
  {
    id: "hu_03_flop_check_option",
    kind: "hu_flop_check",
    bigBlind: BB,
    legalActions: [
      { action: "check", actionType: ACTION_TYPE.CHECK },
      { action: "bet", actionType: ACTION_TYPE.BET, minAmount: String(BB), maxAmount: String(50 * BB) },
    ],
    observation: {
      holeCards: [
        { rank: "J", suit: "c" },
        { rank: "T", suit: "c" },
      ],
      board: [
        { rank: "9", suit: "c" },
        { rank: "2", suit: "d" },
        { rank: "7", suit: "h" },
      ],
      pot: String(6 * BB),
      callAmount: "0",
      street: "flop",
      stacks: [String(97 * BB), String(97 * BB)],
      toActSeat: 0,
      energyRemaining: 92,
      seat: 0,
    },
    evStubBb: { check: 0, bet: 0.1 },
  },
  {
    id: "hu_04_flop_facing_cbet",
    kind: "hu_flop_facing_bet",
    bigBlind: BB,
    legalActions: [
      { action: "fold", actionType: ACTION_TYPE.FOLD },
      { action: "call", actionType: ACTION_TYPE.CALL, minAmount: String(3 * BB), maxAmount: String(3 * BB) },
      {
        action: "raise",
        actionType: ACTION_TYPE.RAISE,
        minAmount: String(9 * BB),
        maxAmount: String(50 * BB),
      },
    ],
    observation: {
      holeCards: [
        { rank: "A", suit: "d" },
        { rank: "7", suit: "d" },
      ],
      board: [
        { rank: "A", suit: "c" },
        { rank: "8", suit: "s" },
        { rank: "3", suit: "h" },
      ],
      pot: String(8 * BB),
      callAmount: String(3 * BB),
      street: "flop",
      stacks: [String(94 * BB), String(91 * BB)],
      toActSeat: 1,
      energyRemaining: 84,
      seat: 1,
    },
    evStubBb: { fold: -0.8, call: 0.1, raise: 0.35 },
  },
  {
    id: "hu_05_turn_probe",
    kind: "hu_turn_probe",
    bigBlind: BB,
    legalActions: [
      { action: "check", actionType: ACTION_TYPE.CHECK },
      { action: "bet", actionType: ACTION_TYPE.BET, minAmount: String(2 * BB), maxAmount: String(40 * BB) },
    ],
    observation: {
      holeCards: [
        { rank: "K", suit: "s" },
        { rank: "9", suit: "s" },
      ],
      board: [
        { rank: "K", suit: "h" },
        { rank: "5", suit: "c" },
        { rank: "2", suit: "d" },
        { rank: "T", suit: "s" },
      ],
      pot: String(12 * BB),
      callAmount: "0",
      street: "turn",
      stacks: [String(90 * BB), String(90 * BB)],
      toActSeat: 0,
      energyRemaining: 76,
      seat: 0,
    },
    evStubBb: { check: 0, bet: 0.12 },
  },
  {
    id: "multi_06_utg_open",
    kind: "multi_preflop_utg",
    bigBlind: BB,
    legalActions: [
      { action: "fold", actionType: ACTION_TYPE.FOLD },
      { action: "call", actionType: ACTION_TYPE.CALL, minAmount: String(BB), maxAmount: String(BB) },
      {
        action: "raise",
        actionType: ACTION_TYPE.RAISE,
        minAmount: String(2.5 * BB),
        maxAmount: String(100 * BB),
      },
    ],
    observation: {
      holeCards: [
        { rank: "A", suit: "h" },
        { rank: "Q", suit: "h" },
      ],
      pot: String(1.5 * BB),
      callAmount: String(BB),
      street: "preflop",
      stacks: [
        String(100 * BB),
        String(100 * BB),
        String(100 * BB),
        String(100 * BB),
        String(100 * BB),
        String(100 * BB),
      ],
      toActSeat: 2,
      energyRemaining: 100,
      seat: 2,
    },
    evStubBb: { fold: -0.2, call: -0.05, raise: 0.2 },
  },
  {
    id: "multi_07_flop_multiway",
    kind: "multi_flop_multiway",
    bigBlind: BB,
    legalActions: [
      { action: "check", actionType: ACTION_TYPE.CHECK },
      { action: "bet", actionType: ACTION_TYPE.BET, minAmount: String(BB), maxAmount: String(30 * BB) },
    ],
    observation: {
      holeCards: [
        { rank: "8", suit: "s" },
        { rank: "8", suit: "d" },
      ],
      board: [
        { rank: "A", suit: "c" },
        { rank: "8", suit: "h" },
        { rank: "2", suit: "s" },
      ],
      pot: String(15 * BB),
      callAmount: "0",
      street: "flop",
      stacks: [String(90 * BB), String(85 * BB), String(95 * BB)],
      toActSeat: 0,
      energyRemaining: 88,
      seat: 0,
    },
    evStubBb: { check: 0.05, bet: 0.4 },
  },
] as const;

export const DEFAULT_PRESETS: readonly PresetKey[] = ["shark", "fox", "professor", "machine"];

export function scenarioToRequest(
  scenario: EvalScenario,
  profileKey: PresetKey,
  extras?: Partial<DecisionRequest>,
): DecisionRequest {
  return {
    legalActions: scenario.legalActions,
    observation: {
      ...scenario.observation,
      handId: scenario.id,
      sessionId: `eval-${profileKey}`,
    },
    profileKey,
    skipSchemaRepair: true,
    actionDeadlineMs: 8_000,
    ...extras,
  };
}
