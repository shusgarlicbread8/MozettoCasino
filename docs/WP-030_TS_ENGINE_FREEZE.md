# WP-030 — TypeScript NLHE Engine Freeze

| Field | Value |
|---|---|
| **Work packet** | WP-030 |
| **Status** | Frozen (differential oracle) |
| **Engine package** | `packages/game-rules` |
| **Build id** | `mozetto-nlhe-ts-freeze-wp030` |
| **State domain** | `MOZETTO_TS_ENGINE_STATE_V1` |
| **Golden fixtures** | `packages/game-rules/fixtures/` |
| **Date** | 2026-08-07 |

## Purpose

Freeze current TypeScript No-Limit Hold'em behavior as the **differential oracle** for future Rust parity (WP-031+). Do not rewrite the engine mid-freeze to match Protocol V3 event encoding; document gaps and migrate deliberately.

## How to verify

```bash
pnpm --filter @mozetto/game-rules test
pnpm --filter @mozetto/game-rules generate:fixtures   # regenerate hashes after intentional engine changes
```

Drift detection: every golden fixture embeds `stateHash` (and often `legalActionsHash`). Tests fail if replay diverges.

## State hash (TS freeze oracle)

**Function:** `hashEngineState(state)` in `packages/game-rules/src/state-hash.ts`.

```text
domainTag = keccak256(bytes("MOZETTO_TS_ENGINE_STATE_V1"))
body      = keccak256(utf8(stableJSON(consensusSnapshot)))
hash      = keccak256(domainTag || body)
```

Consensus snapshot includes blinds/config, street, button, remaining deck, board, pot, seat stacks/bets/flags/hole keys, acting/betting fields, `seedCommit`, winners amounts, rake, `actedThisStreet`, `lastRaiseComplete`.

**Excluded:** `serverSeed`, `playerId`, `agentId`, winner hand labels, wall-clock timestamps.

### vs Protocol V3 `engineHash`

| Digest | Meaning | Value source |
|---|---|---|
| **TS build hash** | Identifies this frozen TS engine | `keccak256(bytes("mozetto-nlhe-ts-freeze-wp030"))` via `tsEngineBuildHash()` |
| **Protocol V3 `engineHash`** | Bound engine build on events / settlement | Season 1 **placeholder** still `keccak256(bytes("mozetto-nlhe-engine-v3-draft"))` per `MOZETTO_POKER_EVENT_V1` §9 until Rust promotion |
| **TS state hash** | Per-state differential oracle | `MOZETTO_TS_ENGINE_STATE_V1` (above) — **not** an ABI event field |

Protocol V3 forbids raw JSON as consensus object preimages. This freeze oracle intentionally uses stable JSON under an explicit TS domain until a formal `ENGINE_STATE` ABI layout is specified post-parity.

## Frozen behaviors

### Blinds / button

- **HU:** button posts SB; other seat posts BB; button acts first preflop; postflop BB acts first (first after button).
- **Multi / six-max:** SB = next after button; BB = next after SB; UTG = next after BB acts first preflop.
- Button advances to next active seated stack on `startHand`.

### Legal actions / raise convention

- Actions: `fold`, `check`, `call`, `bet`, `raise`, `all_in`.
- **Amount convention (frozen):** `bet` / `raise` / `call` / `all_in` amounts are **chips added this action** (not “raise-to” total street commitment). Documented divergence risk vs Protocol V3 recommended raise-to encoding.
- Incomplete all-in raise (`raiseSize < minRaise`) sets `lastRaiseComplete=false`; players who already acted may only fold/call (no reopen).

### Pots / showdown

- Main + side pots via ascending contribution levels (`buildPots`).
- Folded chips remain in layers; folded seats are not eligible.
- Tie split: integer division; odd chips clockwise starting strictly after button among winners.
- Pure HU equal-contribution pots are always even; odd-chip covered with ≥3 contributors / dead money (`multi_13`).

### Rake hooks (present, limited)

- Config: `rakePct` (fraction, e.g. `0.05` = 5%) + optional `rakeCap`.
- Applied in `settleShowdown` when ≥2 live hands; floor + proportional layer distribution.
- `foldWin` always sets `rake: 0` (no flop no drop not modeled as template flag).

### Fold win

- Sole remaining player receives **entire** `state.pot` (includes uncalled portion). **No uncalled-bet return.**

## Six-max coverage status

| Area | Status | Fixture / note |
|---|---|---|
| Blinds / button / UTG | Covered | `sixmax_14_blinds_utg` |
| Fold to BB | Covered | `sixmax_15_fold_to_bb` |
| Side pots / nested | Covered | `multi_11`, `multi_12` |
| Incomplete all-in | Covered | `multi_10` (3-handed street) |
| Odd chip | Covered | `multi_13` |
| Showdown ties | Covered | `hu_07`, `multi_13` |
| Rake / rake cap | Covered | `hu_08`, `hu_09` |
| Full 6-handed deep trees | Partial | Blinds + fold-around only; not exhaustive action trees |
| Sit-out blind posts | Gap | Limited `sitOut` support; not fixture-frozen |
| Timeout / deadline actions | Gap | Not in pure engine |
| Duplicate / short deck rejection | Gap | Deck assumed valid from shuffle |
| Uncalled bet return | Gap | Not implemented (see fold win) |
| `rakeBps` / `noFlopNoDrop` template | Gap | Uses `rakePct` fraction instead of Protocol template bps |

## Gaps vs Protocol V3 event encoding

Frozen specs: `specs/MOZETTO_POKER_EVENT_V1.md`, `specs/MOZETTO_PROTOCOL_V3.md`, vectors `03`–`06`.

| Topic | Protocol V3 / Poker Event V1 | Current TS engine |
|---|---|---|
| Event hash | 13-field ABI `keccak256(abi.encode(...))` with `engineHash` | Runtime `EngineEvent` JSON-ish objects; legacy `canonical-event.ts` uses `mozetto-poker-v1` JSON keccak (pre-V3) |
| Raise amount | Prefer raise-to total; vector 03 uses explicit payloads | Chips-added |
| Card codes | `0..51` suit-major in protocol objects | `{rank,suit}` objects internally |
| Money | Integer base units in ABI | Number chips in engine state |
| Odd chip | Clockwise after button (vector 06) | **Aligned** (same rule) |
| Incomplete all-in | Must not reopen | **Aligned** |
| Side pots | Vector 05 semantics | **Aligned** (PokerKit-validated arithmetic) |
| `engineHash` on events | Placeholder draft id until promotion | TS build id separate; do not silently rewrite V3 vectors |

## Fixture inventory

See `packages/game-rules/fixtures/manifest.json` (19 fixtures). Scenario source: `src/freeze-fixtures.ts`.

## Migration note (do not do in WP-030)

Changing raise convention, pot/rake math, or event encoding requires:

1. Explicit migration doc;
2. New `TS_ENGINE_BUILD_ID` / hashes;
3. Regenerated fixtures;
4. Protocol / Rust parity plan update.

## Acceptance evidence

- `pnpm --filter @mozetto/game-rules test` — freeze + existing unit tests pass.
- Artifacts: `fixtures/*.json`, `src/state-hash.ts`, `docs/WP-030_TS_ENGINE_FREEZE.md`.
