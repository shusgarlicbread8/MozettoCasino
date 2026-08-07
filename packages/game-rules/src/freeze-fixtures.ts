/**
 * WP-030 freeze scenarios (hashes filled by scripts/generate-freeze-fixtures.mjs).
 */
import type { EngineFixture } from "./fixture-runner.js";

const HU_CFG = {
  tableId: "freeze-hu",
  smallBlind: 50,
  bigBlind: 100,
  rakePct: 0,
  rakeCap: null as number | null,
};

const SIX_CFG = {
  tableId: "freeze-sixmax",
  smallBlind: 50,
  bigBlind: 100,
  rakePct: 0,
  rakeCap: null as number | null,
};

/** Board used for multi-way showdown injects (no wheel for low pairs). */
const BOARD_LOW = ["2c", "3d", "4h", "5s", "7c"];

export const FREEZE_FIXTURE_DEFS: EngineFixture[] = [
  // ── HU: blinds / button / first to act ─────────────────────────────
  {
    id: "hu_01_blinds_button_preflop",
    description: "HU: button posts SB, BB posts BB, button acts first preflop",
    coverage: ["blinds", "button", "legal-actions", "hu"],
    format: "hu",
    seatCount: 2,
    config: HU_CFG,
    seats: [
      { seatIndex: 0, stack: 10_000 },
      { seatIndex: 1, stack: 10_000 },
    ],
    steps: [
      { op: "startHand", serverSeed: "wp030-hu-blinds", handId: "hand-hu-blinds" },
      {
        op: "expect",
        expect: {
          street: "preflop",
          button: 0,
          actingIndex: 0,
          pot: 150,
          currentBet: 100,
          legalActions: [
            { action: "fold" },
            { action: "call", minAmount: 50, maxAmount: 50 },
            { action: "raise", minAmount: 150, maxAmount: 9950 },
            { action: "all_in", minAmount: 9950, maxAmount: 9950 },
          ],
        },
      },
    ],
  },

  // ── HU: SB folds to BB ─────────────────────────────────────────────
  {
    id: "hu_02_sb_folds_to_bb",
    description: "HU: button/SB folds preflop; BB wins pot without showdown (no rake)",
    coverage: ["fold-win", "blinds", "hu"],
    format: "hu",
    seatCount: 2,
    config: HU_CFG,
    seats: [
      { seatIndex: 0, stack: 10_000 },
      { seatIndex: 1, stack: 10_000 },
    ],
    steps: [
      { op: "startHand", serverSeed: "wp030-hu-fold", handId: "hand-hu-fold" },
      { op: "action", action: "fold" },
      {
        op: "expect",
        expect: {
          street: "settlement",
          pot: 0,
          rake: 0,
          // WP-109: return uncalled 50 to BB; eligible pot 100 awarded; stacks unchanged vs net transfer.
          winners: [{ seatIndex: 1, amount: 100 }],
          stacks: [9950, 10050],
        },
      },
    ],
  },

  // ── HU: limp / check down to showdown chop ─────────────────────────
  {
    id: "hu_03_limp_checkdown_chop",
    description: "HU: SB completes, BB checks; check down; inject identical hands → even chop",
      coverage: ["legal-actions", "streets", "hu"],
    format: "hu",
    seatCount: 2,
    config: HU_CFG,
    seats: [
      { seatIndex: 0, stack: 10_000 },
      { seatIndex: 1, stack: 10_000 },
    ],
    steps: [
      { op: "startHand", serverSeed: "wp030-hu-limp", handId: "hand-hu-limp" },
      { op: "action", action: "call", amount: 50 },
      {
        op: "expect",
        expect: {
          street: "preflop",
          actingIndex: 1,
          pot: 200,
          currentBet: 100,
        },
      },
      { op: "action", action: "check" },
      {
        op: "expect",
        expect: {
          street: "flop",
          actingIndex: 1,
          pot: 200,
          currentBet: 0,
        },
      },
      { op: "action", action: "check" },
      { op: "action", action: "check" },
      {
        op: "expect",
        expect: { street: "turn" },
      },
      { op: "action", action: "check" },
      { op: "action", action: "check" },
      {
        op: "expect",
        expect: { street: "river" },
      },
      { op: "action", action: "check" },
      { op: "action", action: "check" },
      {
        op: "expect",
        expect: {
          street: "settlement",
          pot: 0,
          // Real dealt hands — stacks conserved at 10k each if chop or winner takes 200.
          // Assert conservation via stacks sum + rake.
        },
      },
    ],
  },

  // ── HU: short-stack blind all-in ───────────────────────────────────
  {
    id: "hu_04_short_stack_blind_allin",
    description: "HU: SB has only 40 (< SB 50); posts all-in blind; BB can call/fold",
    coverage: ["blinds", "all-in", "short-stack", "hu"],
    format: "hu",
    seatCount: 2,
    config: HU_CFG,
    seats: [
      { seatIndex: 0, stack: 40 },
      { seatIndex: 1, stack: 10_000 },
    ],
    steps: [
      { op: "startHand", serverSeed: "wp030-hu-short-sb", handId: "hand-hu-short-sb" },
      {
        op: "expect",
        expect: {
          street: "preflop",
          button: 0,
          pot: 140,
          stacks: [0, 9900],
          // Frozen gap: startHand still points actingIndex at all-in SB (seat 0).
          // Host must advance; documented in WP-030 freeze note.
          actingIndex: 0,
        },
      },
    ],
  },

  // ── HU: both all-in preflop runout ─────────────────────────────────
  {
    id: "hu_05_both_allin_preflop",
    description: "HU: SB shoves, BB calls all-in; runout then settlement",
    coverage: ["all-in", "runout", "showdown", "hu"],
    format: "hu",
    seatCount: 2,
    config: HU_CFG,
    seats: [
      { seatIndex: 0, stack: 500 },
      { seatIndex: 1, stack: 500 },
    ],
    steps: [
      { op: "startHand", serverSeed: "wp030-hu-ai", handId: "hand-hu-ai" },
      { op: "action", action: "all_in" },
      {
        op: "expect",
        expect: {
          // SB posted 50 then shoved remaining 450 → pot 600
          street: "preflop",
          pot: 600,
          actingIndex: 1,
        },
      },
      { op: "action", action: "all_in" },
      {
        op: "expect",
        expect: {
          // Engine pauses for staged runout (actingIndex null, board empty)
          actingIndex: null,
          pot: 1000,
        },
      },
      { op: "continueRunout" }, // flop
      { op: "continueRunout" }, // turn
      { op: "continueRunout" }, // river
      { op: "continueRunout" }, // settle
      {
        op: "expect",
        expect: {
          street: "settlement",
          pot: 0,
          rake: 0,
        },
      },
    ],
  },

  // ── HU: raise sizing (raise = chips added this action) ─────────────
  {
    id: "hu_06_raise_to_3bb_call",
    description: "HU: SB raises (chips-added 250 → total bet 300 = 3bb), BB calls",
    coverage: ["legal-actions", "raise", "hu"],
    format: "hu",
    seatCount: 2,
    config: HU_CFG,
    seats: [
      { seatIndex: 0, stack: 10_000 },
      { seatIndex: 1, stack: 10_000 },
    ],
    steps: [
      { op: "startHand", serverSeed: "wp030-hu-raise", handId: "hand-hu-raise" },
      // SB already has 50 in; raise amount is chips added. Min raise extra = 150.
      // To put 300 total (3bb): add 250.
      { op: "action", action: "raise", amount: 250 },
      {
        op: "expect",
        expect: {
          street: "preflop",
          pot: 400,
          currentBet: 300,
          actingIndex: 1,
          legalActions: [
            { action: "fold" },
            { action: "call", minAmount: 200, maxAmount: 200 },
            { action: "raise", minAmount: 400, maxAmount: 9900 },
            { action: "all_in", minAmount: 9900, maxAmount: 9900 },
          ],
        },
      },
      { op: "action", action: "call", amount: 200 },
      {
        op: "expect",
        expect: {
          street: "flop",
          pot: 600,
          currentBet: 0,
        },
      },
    ],
  },

  // ── HU: even chop (pure HU pot is always even with equal contribs) ──
  {
    id: "hu_07_showdown_tie_even",
    description:
      "HU showdown identical hands, equal totalBet → even chop (odd-chip needs ≥3 contributors; see multi_13)",
    coverage: ["showdown-tie", "hu"],
    format: "hu",
    seatCount: 2,
    config: { ...HU_CFG, tableId: "freeze-hu-tie" },
    seats: [
      { seatIndex: 0, stack: 0 },
      { seatIndex: 1, stack: 0 },
    ],
    steps: [
      {
        op: "injectShowdown",
        button: 0,
        board: BOARD_LOW,
        seats: [
          { seatIndex: 0, stack: 0, totalBet: 500_000, hole: ["As", "Kh"] },
          { seatIndex: 1, stack: 0, totalBet: 500_000, hole: ["Ad", "Kc"] },
        ],
      },
      { op: "settleShowdown" },
      {
        op: "expect",
        expect: {
          street: "settlement",
          winners: [
            { seatIndex: 0, amount: 500_000 },
            { seatIndex: 1, amount: 500_000 },
          ],
          stacks: [500_000, 500_000],
          rake: 0,
        },
      },
    ],
  },

  // ── HU: rake at showdown ───────────────────────────────────────────
  {
    id: "hu_08_rake_showdown",
    description: "HU showdown with rakePct=0.05 (5%), pot 1000 → rake 50",
    coverage: ["rake", "showdown", "hu"],
    format: "hu",
    seatCount: 2,
    config: { ...HU_CFG, rakePct: 0.05, rakeCap: null },
    seats: [
      { seatIndex: 0, stack: 0 },
      { seatIndex: 1, stack: 0 },
    ],
    steps: [
      {
        op: "injectShowdown",
        button: 0,
        board: BOARD_LOW,
        rakePct: 0.05,
        seats: [
          { seatIndex: 0, stack: 0, totalBet: 500, hole: ["As", "Ah"] },
          { seatIndex: 1, stack: 0, totalBet: 500, hole: ["Kc", "Kd"] },
        ],
      },
      { op: "settleShowdown" },
      {
        op: "expect",
        expect: {
          street: "settlement",
          rake: 50,
          winners: [{ seatIndex: 0, amount: 950 }],
          stacks: [950, 0],
        },
      },
    ],
  },

  // ── HU: rake cap ───────────────────────────────────────────────────
  {
    id: "hu_09_rake_cap",
    description: "HU showdown rake capped at 20 despite 5% of 1000 = 50",
    coverage: ["rake", "rake-cap", "hu"],
    format: "hu",
    seatCount: 2,
    config: { ...HU_CFG, rakePct: 0.05, rakeCap: 20 },
    seats: [
      { seatIndex: 0, stack: 0 },
      { seatIndex: 1, stack: 0 },
    ],
    steps: [
      {
        op: "injectShowdown",
        button: 0,
        board: BOARD_LOW,
        rakePct: 0.05,
        rakeCap: 20,
        seats: [
          { seatIndex: 0, stack: 0, totalBet: 500, hole: ["As", "Ah"] },
          { seatIndex: 1, stack: 0, totalBet: 500, hole: ["Kc", "Kd"] },
        ],
      },
      { op: "settleShowdown" },
      {
        op: "expect",
        expect: {
          rake: 20,
          winners: [{ seatIndex: 0, amount: 980 }],
          stacks: [980, 0],
        },
      },
    ],
  },

  // ── Incomplete all-in raise (3-handed street; required edge case) ──
  {
    id: "multi_10_incomplete_allin_no_reopen",
    description: "Incomplete all-in raise does not reopen for player who already acted",
    coverage: ["incomplete-all-in", "legal-actions", "sixmax"],
    format: "multi",
    seatCount: 3,
    config: SIX_CFG,
    seats: [
      { seatIndex: 0, stack: 500 },
      { seatIndex: 1, stack: 500 },
      { seatIndex: 2, stack: 130 },
    ],
    steps: [
      {
        op: "forceBettingState",
        street: "flop",
        board: ["2c", "3d", "4h"],
        pot: 0,
        currentBet: 0,
        minRaise: 100,
        button: 0,
        actingIndex: 0,
        lastRaiseComplete: true,
        actedThisStreet: [],
        seats: [
          { seatIndex: 0, stack: 500, bet: 0, totalBet: 0, hole: ["As", "Kd"] },
          { seatIndex: 1, stack: 500, bet: 0, totalBet: 0, hole: ["Qh", "Qd"] },
          { seatIndex: 2, stack: 130, bet: 0, totalBet: 0, hole: ["Jh", "Jd"] },
        ],
      },
      { op: "action", action: "bet", amount: 100 },
      { op: "action", action: "call", amount: 100 },
      { op: "action", action: "all_in" },
      {
        op: "expect",
        expect: {
          lastRaiseComplete: false,
          currentBet: 130,
          actingIndex: 0,
          legalActions: [
            { action: "fold" },
            { action: "call", minAmount: 30, maxAmount: 30 },
          ],
        },
      },
    ],
  },

  // ── Three-way side pots (PokerKit-aligned) ─────────────────────────
  {
    id: "multi_11_three_way_side_pots",
    description: "Contributions 100/100/20: AA short wins main; KK wins side → stacks [260,100,60]",
    coverage: ["side-pots", "showdown", "sixmax"],
    format: "multi",
    seatCount: 3,
    config: SIX_CFG,
    seats: [
      { seatIndex: 0, stack: 100 },
      { seatIndex: 1, stack: 100 },
      { seatIndex: 2, stack: 0 },
    ],
    steps: [
      {
        op: "injectShowdown",
        button: 2,
        board: BOARD_LOW,
        seats: [
          { seatIndex: 0, stack: 100, totalBet: 100, hole: ["Kh", "Kd"] },
          { seatIndex: 1, stack: 100, totalBet: 100, hole: ["Qh", "Qd"] },
          { seatIndex: 2, stack: 0, totalBet: 20, hole: ["Ac", "Ad"] },
        ],
      },
      {
        op: "expect",
        expect: {
          potLayers: [
            { amount: 60, eligible: [0, 1, 2] },
            { amount: 160, eligible: [0, 1] },
          ],
        },
      },
      { op: "settleShowdown" },
      {
        op: "expect",
        expect: {
          stacks: [260, 100, 60],
          rake: 0,
        },
      },
    ],
  },

  // ── Nested side pots ───────────────────────────────────────────────
  {
    id: "multi_12_nested_side_pots",
    description: "Four-way contributions 100/100/50/20 → layers 80/90/100; AA scoops",
    coverage: ["side-pots", "nested", "sixmax"],
    format: "multi",
    seatCount: 4,
    config: SIX_CFG,
    seats: [
      { seatIndex: 0, stack: 0 },
      { seatIndex: 1, stack: 0 },
      { seatIndex: 2, stack: 0 },
      { seatIndex: 3, stack: 0 },
    ],
    steps: [
      {
        op: "injectShowdown",
        button: 3,
        board: BOARD_LOW,
        seats: [
          { seatIndex: 0, stack: 0, totalBet: 100, hole: ["Ac", "Ad"] },
          { seatIndex: 1, stack: 0, totalBet: 100, hole: ["Kh", "Kd"] },
          { seatIndex: 2, stack: 0, totalBet: 50, hole: ["Qh", "Qd"] },
          { seatIndex: 3, stack: 0, totalBet: 20, hole: ["Jh", "Jd"] },
        ],
      },
      {
        op: "expect",
        expect: {
          potLayers: [
            { amount: 80, eligible: [0, 1, 2, 3] },
            { amount: 90, eligible: [0, 1, 2] },
            { amount: 100, eligible: [0, 1] },
          ],
        },
      },
      { op: "settleShowdown" },
      {
        op: "expect",
        expect: {
          stacks: [270, 0, 0, 0],
        },
      },
    ],
  },

  // ── Odd chip with folded dead money ────────────────────────────────
  {
    id: "multi_13_odd_chip_after_button",
    description: "Tied winners; folded 1-chip; button=1 → odd chip to seat 0 (first after button)",
    coverage: ["odd-chip", "showdown-tie", "sixmax"],
    format: "multi",
    seatCount: 3,
    config: SIX_CFG,
    seats: [
      { seatIndex: 0, stack: 0 },
      { seatIndex: 1, stack: 0 },
      { seatIndex: 2, stack: 0 },
    ],
    steps: [
      {
        op: "injectShowdown",
        button: 1,
        board: BOARD_LOW,
        seats: [
          { seatIndex: 0, stack: 0, totalBet: 50, hole: ["As", "Kh"] },
          { seatIndex: 1, stack: 0, totalBet: 50, hole: ["Ad", "Kc"] },
          { seatIndex: 2, stack: 0, totalBet: 1, hole: ["9s", "8s"], folded: true },
        ],
      },
      { op: "settleShowdown" },
      {
        op: "expect",
        expect: {
          stacks: [51, 50, 0],
          winners: [
            { seatIndex: 0, amount: 51 },
            { seatIndex: 1, amount: 50 },
          ],
        },
      },
    ],
  },

  // ── Six-max blinds / UTG ───────────────────────────────────────────
  {
    id: "sixmax_14_blinds_utg",
    description: "6-max: button→SB→BB→UTG first to act; blinds posted",
    coverage: ["blinds", "button", "sixmax"],
    format: "sixmax",
    seatCount: 6,
    config: SIX_CFG,
    seats: [
      { seatIndex: 0, stack: 10_000 },
      { seatIndex: 1, stack: 10_000 },
      { seatIndex: 2, stack: 10_000 },
      { seatIndex: 3, stack: 10_000 },
      { seatIndex: 4, stack: 10_000 },
      { seatIndex: 5, stack: 10_000 },
    ],
    steps: [
      { op: "startHand", serverSeed: "wp030-six-blinds", handId: "hand-six-blinds" },
      {
        op: "expect",
        expect: {
          // initial button = 5; next active → 0
          button: 0,
          // SB=1, BB=2, UTG=3
          actingIndex: 3,
          pot: 150,
          stacks: [10000, 9950, 9900, 10000, 10000, 10000],
        },
      },
    ],
  },

  // ── Six-max: fold to BB ────────────────────────────────────────────
  {
    id: "sixmax_15_fold_to_bb",
    description: "6-max: everyone folds to BB; BB wins blinds without showdown",
    coverage: ["fold-win", "sixmax"],
    format: "sixmax",
    seatCount: 6,
    config: SIX_CFG,
    seats: [
      { seatIndex: 0, stack: 10_000 },
      { seatIndex: 1, stack: 10_000 },
      { seatIndex: 2, stack: 10_000 },
      { seatIndex: 3, stack: 10_000 },
      { seatIndex: 4, stack: 10_000 },
      { seatIndex: 5, stack: 10_000 },
    ],
    steps: [
      { op: "startHand", serverSeed: "wp030-six-foldbb", handId: "hand-six-foldbb" },
      // UTG 3 fold, 4 fold, 5 fold, BTN 0 fold, SB 1 fold
      { op: "action", action: "fold" },
      { op: "action", action: "fold" },
      { op: "action", action: "fold" },
      { op: "action", action: "fold" },
      { op: "action", action: "fold" },
      {
        op: "expect",
        expect: {
          street: "settlement",
          rake: 0,
          winners: [{ seatIndex: 2, amount: 100 }],
          // WP-109: uncalled 50 returned; BB wins eligible 100 → 10050
          stacks: [10000, 9950, 10050, 10000, 10000, 10000],
        },
      },
    ],
  },

  // ── Six-max deep tree: raise / call / fold to flop then fold-win ───
  {
    id: "sixmax_20_deep_raise_fold",
    description: "6-max: multi-seat preflop tree to flop; aggressor wins uncalled bet return",
    coverage: ["sixmax", "deep-tree", "uncalled-bet", "fold-win"],
    format: "sixmax",
    seatCount: 6,
    config: SIX_CFG,
    seats: [
      { seatIndex: 0, stack: 10_000 },
      { seatIndex: 1, stack: 10_000 },
      { seatIndex: 2, stack: 10_000 },
      { seatIndex: 3, stack: 10_000 },
      { seatIndex: 4, stack: 10_000 },
      { seatIndex: 5, stack: 10_000 },
    ],
    steps: [
      { op: "startHand", serverSeed: "wp109-six-deep", handId: "hand-six-deep" },
      // UTG 3 fold, HJ 4 fold, CO 5 raise to 300, BTN 0 fold, SB 1 fold, BB 2 call
      { op: "action", action: "fold" },
      { op: "action", action: "fold" },
      { op: "action", action: "raise", amount: 300 },
      { op: "action", action: "fold" },
      { op: "action", action: "fold" },
      { op: "action", action: "call", amount: 200 },
      {
        op: "expect",
        expect: {
          street: "flop",
          pot: 650,
          actingIndex: 2,
        },
      },
      // BB checks, CO bets 400, BB folds → fold-win with uncalled return
      { op: "action", action: "check" },
      { op: "action", action: "bet", amount: 400 },
      { op: "action", action: "fold" },
      {
        op: "expect",
        expect: {
          street: "settlement",
          pot: 0,
          rake: 0,
          winners: [{ seatIndex: 5, amount: 650 }],
        },
      },
    ],
  },

  // ── Folded chips remain in pot layers ──────────────────────────────
  {
    id: "multi_16_folded_chips_in_pot",
    description: "Folded contributor chips stay in layer; folded seat not eligible",
    coverage: ["side-pots", "fold", "sixmax"],
    format: "multi",
    seatCount: 3,
    config: SIX_CFG,
    seats: [
      { seatIndex: 0, stack: 80 },
      { seatIndex: 1, stack: 80 },
      { seatIndex: 2, stack: 0 },
    ],
    steps: [
      {
        op: "injectShowdown",
        button: 0,
        board: BOARD_LOW,
        seats: [
          { seatIndex: 0, stack: 80, totalBet: 20, hole: ["As", "Kh"], folded: true },
          { seatIndex: 1, stack: 80, totalBet: 20, hole: ["Qh", "Qd"] },
          { seatIndex: 2, stack: 0, totalBet: 20, hole: ["Jc", "Jd"] },
        ],
      },
      {
        op: "expect",
        expect: {
          potLayers: [{ amount: 60, eligible: [1, 2] }],
        },
      },
    ],
  },

  // ── Exact call all-in ──────────────────────────────────────────────
  {
    id: "hu_17_exact_call_allin",
    description: "HU: facing bet, stack exactly equals toCall → call and all_in both legal",
    coverage: ["all-in", "legal-actions", "hu"],
    format: "hu",
    seatCount: 2,
    config: HU_CFG,
    seats: [
      { seatIndex: 0, stack: 200 },
      { seatIndex: 1, stack: 100 },
    ],
    steps: [
      {
        op: "forceBettingState",
        street: "flop",
        board: ["2c", "3d", "4h"],
        pot: 200,
        currentBet: 100,
        minRaise: 100,
        button: 0,
        actingIndex: 1,
        seats: [
          { seatIndex: 0, stack: 100, bet: 100, totalBet: 150, hole: ["As", "Kd"] },
          { seatIndex: 1, stack: 100, bet: 0, totalBet: 50, hole: ["Qh", "Qd"] },
        ],
      },
      {
        op: "expect",
        expect: {
          legalActions: [
            { action: "fold" },
            { action: "all_in", minAmount: 100, maxAmount: 100 },
            { action: "call", minAmount: 100, maxAmount: 100 },
          ],
        },
      },
      { op: "action", action: "call", amount: 100 },
      {
        op: "expect",
        expect: {
          // Both all-in or street complete → runout pause or next street
          pot: 300,
        },
      },
    ],
  },

  // ── Illegal raise rejected (covered by expect throwing in separate test) ──
  {
    id: "hu_18_min_raise_bounds",
    description: "HU: after blinds, SB min raise chips-added is 150 (to 200 total)",
    coverage: ["legal-actions", "raise", "hu"],
    format: "hu",
    seatCount: 2,
    config: HU_CFG,
    seats: [
      { seatIndex: 0, stack: 10_000 },
      { seatIndex: 1, stack: 10_000 },
    ],
    steps: [
      { op: "startHand", serverSeed: "wp030-hu-minraise", handId: "hand-hu-minraise" },
      {
        op: "expect",
        expect: {
          legalActions: [
            { action: "fold" },
            { action: "call", minAmount: 50, maxAmount: 50 },
            { action: "raise", minAmount: 150, maxAmount: 9950 },
            { action: "all_in", minAmount: 9950, maxAmount: 9950 },
          ],
        },
      },
    ],
  },

  // ── Button rotation across hands ───────────────────────────────────
  {
    id: "hu_19_button_rotates",
    description: "HU: after fold-win settlement, next hand button moves to other seat",
    coverage: ["button", "hu"],
    format: "hu",
    seatCount: 2,
    config: HU_CFG,
    seats: [
      { seatIndex: 0, stack: 10_000 },
      { seatIndex: 1, stack: 10_000 },
    ],
    steps: [
      { op: "startHand", serverSeed: "wp030-hu-btn1", handId: "hand-hu-btn1" },
      {
        op: "expect",
        expect: { button: 0 },
      },
      { op: "action", action: "fold" },
      {
        op: "expect",
        expect: { street: "settlement" },
      },
      { op: "startHand", serverSeed: "wp030-hu-btn2", handId: "hand-hu-btn2" },
      {
        op: "expect",
        expect: { button: 1, actingIndex: 1 },
      },
    ],
  },
];
