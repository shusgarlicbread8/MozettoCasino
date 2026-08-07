# WP-033 — Hand Evaluator

| Field | Value |
|---|---|
| **Work packet** | WP-033 |
| **Status** | DONE |
| **Crates / packages** | `crates/poker-eval`, `@mozetto/game-rules` (`hand-rank`) |
| **Shared vectors** | `crates/poker-eval/vectors/hand_eval_v1.json` |
| **Card mapping** | Protocol V3 suit-major `0..51` (`specs/MOZETTO_PROTOCOL_V3.md` §6) |
| **Date** | 2026-08-07 |

## Scope

Independent, pure hand evaluator with golden test vectors:

- five-card ranking (`rank_five` / `rankFive`);
- seven-card Hold'em best-of-five (`best_hand` / `bestHand`);
- category ordering (high card → royal flush);
- ties and kicker lexicographic order;
- Protocol V3 card codes (`card_code` / `cardCode`).

No I/O, no WASM (WP-035), no PokerKit CI harness (WP-034 — hook only).

## How to verify

```bash
cargo test -p poker-eval -p poker-core
pnpm --filter @mozetto/game-rules test
cargo test -p protocol-vectors-rs   # must remain green
```

## Vector coverage (`hand_eval_v1`)

| Kind | What it asserts |
|---|---|
| `five_card` | Exact category, score vector, label (optional `codes[]` for 0..51) |
| `compare_five` | Lexicographic cmp (+1 / 0 / −1) for kickers & category order |
| `holdem_best` | 7-card best-of category/score (three-pair pick, boat, flush, SF, royal) |
| `holdem_compare` | Heads-up showdown cmp + categories on shared boards |

Categories covered: high card, pair, two pair, trips, straight (wheel / six-high / broadway), flush, full house, quads, straight flush, royal flush. Kickers: pair, two-pair, trips, flush, quads, full-house pair rank. Ties: identical five-card strength, board-plays chop, dry AK chop.

## Cross-check (TS ↔ Rust)

Both load the same JSON:

| Side | Runner |
|---|---|
| Rust | `crates/poker-eval/tests/hand_eval_vectors.rs` |
| TypeScript | `packages/game-rules/src/hand-eval-vectors.test.ts` |

Score vectors and category snake_case ids must match exactly. Spec hashes / Protocol V3 ABI vectors are untouched.

## API surface (`poker-eval`)

| Item | Role |
|---|---|
| `rank_five` | Exactly five cards |
| `best_hand` | Hole + board → best five |
| `compare_scores` | Lexicographic score compare |
| `HandCategory::{score,as_str,from_str}` | Category ids aligned with TS |
| `card_code` / `card_from_code` | Protocol V3 `0..51` |
| `DIFFERENTIAL_ORACLE_ID` | PokerKit hand-eval id (`pokerkit_standard_high_hand`); harness in WP-034 |

## Deliberately not in this packet

- PokerKit differential generators / CI → see `docs/WP-034_DIFFERENTIAL_HARNESS.md`
- WASM verifier (WP-035)
- Spec hash or `/specs` edits
- `contracts/` (WP-022+)

## Relation to engine fixtures

`poker-core` HU / six-max fixture replay continues to use `best_hand` for showdown. WP-033 must not regress those fixtures.
