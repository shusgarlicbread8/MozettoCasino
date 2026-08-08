# Cities cash poker — launch checklist (NLHE_ENGINE_RC1)

Gate status for treating Cities as launch-ready. Failing conservation is a ship blocker.

## G0 — Money / rake freeze

- [x] `HoldemState` chips are `bigint` (cent grid)
- [x] Net-on-award: stacks credit `gross − rake`; `sessionRake` accumulates
- [x] Integer rake caps via milliBB (`rakeCapFromMilliBb`)
- [x] Property pot invariants + game-rules suite green
- [x] Plan 11 docs describe net stacks

## G1 — On-chain stake enforcement

- [x] Per-city `GameTemplateV2` registration (`NLHE_HU_<CITY>_V1` / six-max)
- [x] `ArenaVault` rejects buy-in outside `[minBuyIn, maxBuyIn]` (40–100BB)
- [x] Variable buy-in seat tickets (player-chosen)
- [~] Berlin HU Alice $40 + Bob $100 → balances + rake = $140 (offline PASS; chain leg needs `--run`)
- [ ] Anvil E2E: six-max mixed depths (40/53/75/80/100/100 BB)

## G2 — Engine recertification

- [x] Build ids: `mozetto-nlhe-ts-rc1` / `mozetto-nlhe-engine-rc1`
- [x] Fixtures regenerated under RC1
- [x] `pnpm test:engine-diff` PASS (TS ↔ Rust)
- [x] `pnpm test:engine-diff:nightly` script present
- [ ] `pnpm test:engine-diff:full` (PokerKit) on CI/nightly
- [ ] Large conservation campaign (≥100k scenarios) green in CI

## G3 — Cash table lifecycle

- [x] Hand-boundary leave (WP-042 queue) + net stacks (no rake clawback)
- [x] Sit-out API (`POST /v1/tables/:id/sit-out`) ≠ Leave
- [x] Top-up capped at 100BB fresh funds
- [x] Rat-hole persistence + find-match enforcement
- [x] `SEASON1_CASH_MECHANICS` (antes/straddles/RIT/bomb/insurance OFF)
- [x] Missed-blind wait-for-BB enforced in deal loop (`releaseSeatsAwaitingBigBlind`)

## G4 — AI Intelligence V2

- [x] Live HUD stats: VPIP / open / 3bet / fold-to-3bet on table-runtime
- [x] `AgentState` summary injected into final `decide`
- [x] Event-importance Energy (deep decision on large pot / short SPR / river)
- [ ] DB-backed AgentState/Energy as production default
- [ ] Postflop range narrowing + hand plans fully live

## G5 — Cities product

- [x] Lobby shows `$SB/$BB`, NLHE, buy-in band (40–100BB)
- [x] Porto = Casual (unranked, soft pair-cap); Berlin→Monaco ranked
- [x] `cityId` alias for `leagueId`
- [ ] Premium city presentation only after G0–G4 green

---

# Pre-Manual-Test Gate

One command answers "is this build safe enough for a human to play?":

```bash
pnpm test:preplay          # required checks
pnpm test:preplay --list    # show what it runs, without running
```

Exit codes: `0` gate open · `1` a check failed · `2` everything that ran passed
but a REQUIRED check could not run (missing tool or env var). **A skipped
required check is not a pass.**

## Status as last verified

| Check | Status |
| --- | --- |
| TypeScript, every package | PASS |
| Poker engine unit + property suites | PASS |
| Migration integrity (ordering, FK-safe deletes, city drift) | PASS |
| Custody ABI conformance | PASS |
| Game server + agent runtime | PASS |
| TS ↔ Rust engine differential (fixtures + 25 random streams) | PASS |
| Cash conservation campaign | PASS |
| Protocol vectors (TS) | PASS |
| Chain manifest / city templates | PASS |
| Solidity contract suite (forge) | PASS |
| Unequal buy-in E2E (Berlin 40BB vs 100BB) | PASS (offline leg) |
| Apply migrations to `DATABASE_URL` | **PASS** (033 + 034 applied via Supabase pooler) |

## P0 items and what closed them

1. **`arena-onchain.ts` type error** — resolved. Note it was silenced with 21
   `as never` casts, so ABI arguments are not type-checked. `custody-abi.test.ts`
   re-establishes that guarantee at test time by encoding real arguments against
   the actual ABI (including a two-seat unequal buy-in), and includes a negative
   case proving the encoder really validates.

2. **Unequal buy-in E2E** — `pnpm test:unequal-buyin`. Offline leg asserts band
   enforcement, shared stake pool, 40BB effective stack, natural divergence,
   explicit uncalled returns, and `Alice + Bob + rake === $140` after **every
   hand** across 200 sessions / ~1,100 hands. Chain leg requires `--run` with a
   live Anvil and deployed contracts.

3. **Wait-for-big-blind** — enforced. Season 1 policy:
   - Sit out takes effect at the next hand boundary.
   - Sitting back in waits for the player's natural big blind; there is no
     post-a-missed-blind shortcut in Season 1.

   `nextBlindSeats()` in the engine predicts the button/blinds without mutating
   state, and `blind-policy.test.ts` proves it matches what `startHand` actually
   deals 2/3/4/6-handed, so enforcement cannot drift from the deal logic. The
   seat stays `sitOut` in engine state (leaving RC1 hashing untouched) and is
   released by `releaseSeatsAwaitingBigBlind()` at the top of `beginHand` —
   before the seated-count gate, so a returning player can be the second player
   a table needs.

4. **Real full-path run** — NOT DONE. Requires Postgres, `GROQ_API_KEY` and the
   running services; see below.

5. **Migrations 033/034** — **applied** to the Supabase pooler `DATABASE_URL`
   (033 cities stake ladder + 034 rat-hole exits). The guarded sovereign delete
   landed cleanly; `migrations.test.ts` still fails on any unguarded delete from
   a referenced table. Direct host DNS (`db.*.supabase.co`) is unreachable from
   this machine — use the pooler URL for migrate.

6. **`pnpm test:preplay`** — added.

## To finish the gate on your machine

```bash
# 1. Start Postgres, then apply every migration from zero
export DATABASE_URL=postgres://...
pnpm db:migrate

# 2. Re-run the gate — it must print GATE OPEN
pnpm test:preplay

# 3. Chain leg of the unequal buy-in E2E
anvil &                       # deploy contracts, write chain-manifest/deployments/anvil.json
node --import tsx scripts/unequal-buyin-e2e.mjs --run

# 4. Real full path (P0 #4): web → API → sealAndFundSession → Groq → canonical
#    roots → settlement. Needs GROQ_API_KEY set and no stub settlement roots.
```

## Simulation campaign (WS-G)

```bash
# Fixture parity
pnpm test:engine-diff

# Random differential (scale up with --nightly)
pnpm test:engine-diff:random
pnpm test:engine-diff:nightly   # when PokerKit venv ready

# London $1/$2 conservation sim (demo path)
pnpm --filter @mozetto/game-rules exec node --import tsx ../../scripts/london-cash-sim.mjs
```

Assert on every sim run:

1. No money created/destroyed except declared rake
2. `UNCALLED_BET_RETURNED` when applicable
3. Opening funds = final stacks + sessionRake
4. Variable buy-ins conserve at settlement
