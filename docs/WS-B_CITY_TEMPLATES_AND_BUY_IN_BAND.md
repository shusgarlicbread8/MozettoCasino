# WS-B — Per-city templates, buy-in band enforcement, variable buy-ins

**Date:** 2026-08-08

The rule this workstream makes true on-chain:

> The table's blind level decides how much money may enter the game.
> A player's bankroll never does.

A city fixes its small/big blind. A player then chooses a buy-in **inside** that
city's 40–100BB band. A whale sitting in Porto may still only bring 100BB. Stacks
grow past 100BB only by being won.

Before WS-B the registry accepted any `minBuyIn ≤ maxBuyIn`, one shared template
served every city, the vault never re-read the band, and every seat was funded at
the city maximum regardless of what the player asked for.

---

## Template id naming

Season 1 ids are frozen preimages, hashed with `keccak256`:

```text
NLHE_HU_<CITY>_V1        heads-up, maxSeats 2
NLHE_SIXMAX_<CITY>_V1    six-max,  maxSeats 6
```

`<CITY>` is the **uppercased city id** — the same string persisted as
`tables.league_id` and carried on the seat ticket — not the display name.

| City id | Room | Blinds (USDC) | Buy-in band | League bit | Ranked |
|---|---|---|---|---|---|
| `casual` | Porto | 0.25 / 0.50 | 20 – 50 | 16 | no |
| `bronze` | Berlin | 0.50 / 1 | 40 – 100 | 1 | yes |
| `silver` | London | 1 / 2 | 80 – 200 | 2 | yes |
| `gold` | Singapore | 2.50 / 5 | 200 – 500 | 4 | yes |
| `platinum` | Dubai | 5 / 10 | 400 – 1 000 | 8 | yes |
| `diamond` | Monaco | 25 / 50 | 2 000 – 5 000 | 32 | yes |

Bodies live in `contracts/script/CityTemplates.sol`; the ladder mirrors
`packages/game-rules/src/cities.ts`. A new stake or rule set means a **new id** —
template bodies are immutable once registered.

`NLHE_HU_STANDARD_V2` / `NLHE_SIXMAX_STANDARD_V2` stay registered at Berlin stakes
because canonical protocol vectors and the WP-106 golden path embed them.

Deploy coverage: heads-up for all six cities, six-max for Berlin and London only —
the deeper rooms stay heads-up until there is population to fill six seats.

---

## `rakePolicyHash`

Each template commits to its city's rake schedule:

```text
rakePolicyHash = keccak256(abi.encode(
  uint16  rakeBps,          // 300 = 3%
  uint32  rakeCapMilliBB,   // 2000 = 2.00 BB
  bool    noFlopNoDrop,     // true for all of Season 1
  uint256 chipUnitAtoms     // 10_000 = $0.01
))
```

The cap is carried in **milli-big-blinds**, not dollars, so it scales with the
city instead of drifting against it. Values mirror the provisional Plan 11
schedule in `arenaRakeForLeague` (`packages/database/src/matchmaking.ts`).

---

## Enforcement

**`GameRegistryV2._validateBody`** rejects any Season 1 body whose band is not
exactly the blind level's 40–100BB:

```solidity
if (t.minBuyIn != MIN_BUY_IN_BB * t.bigBlind) revert InvalidTemplate();
if (t.maxBuyIn != MAX_BUY_IN_BB * t.bigBlind) revert InvalidTemplate();
```

A new view, `buyInBand(templateId)`, returns `(minBuyIn, maxBuyIn)` and `(0, 0)`
for a template the registry never saw.

**`ArenaVaultV2`** re-reads that band on every lock — `sealAndFundSession`,
`openSession`, and `topUpSession` — and reverts `BuyInOutOfBand()` for a ticket
outside it. Two deliberate escape hatches: no registry configured, and an
unregistered template (which `_requireActiveTemplate` already rejects with the
clearer `TemplateNotActive`, so the band check must not shadow it).

The vault is the backstop, not the UX. The API validates first so a player gets a
readable `buy_in_out_of_range` instead of an opaque revert.

---

## Seamless play is now per city

`ArenaAccount.lockBuyIn` reverts `TemplateNotAllowed()` unless the seat ticket
names the exact template the `GamePermission` was signed for, and a template is
one city's table. A grant therefore covers one city.

Before WS-B every city minted tickets under `NLHE_HU_STANDARD_V2`, so a Monaco
session was sealed on-chain under Berlin's blinds and Berlin's rake commitment.
The permanent record was wrong. Tickets now carry `cityTemplateId(cityId)`.

`GET /v1/arena/play-status?cityId=…` returns the defaults for that city and sets
`permissionUpgradeRequired` when the existing grant names another one. A player
moving from Berlin to Monaco re-signs once; the UI already routes that through
the "Enable Seamless Play" sheet, and both the pre-flight check and the
`TemplateNotAllowed` revert map to `permission_upgrade_required`.

Classic (six-max) still rides the heads-up id, exactly as before. The six-max
ids are registered for Berlin and London, but moving the Classic seating path
onto them is separate work.

---

## Variable buy-ins

`GET /v1/arena/ticket-params` accepts `buyIn` (USDC) and returns the band
(`minBuyInUsdc` / `maxBuyInUsdc` / `minBuyInBb` / `maxBuyInBb`) so a client can
render a slider. Omitting it still yields the 100BB ceiling.

`POST /v1/arena/find-match` forwards the player's chosen `buyIn` into the on-chain
handler, which resolves it through `resolveBuyIn` → `seatBuyInRaw`.

Downstream, exposure reservations and `onchain_session_players` rows read each
seat's **own** ticket amount rather than one shared city maximum, so seats with
different stacks settle correctly.

---

## Known limitations

- `claimTicketPair` still pairs on an exact `buy_in` match, so heads-up opponents
  always arrive with equal stacks. The custody path already supports unequal
  seats — the descriptor's opening-balance leaves are per ticket — but unequal
  pairing needs the seating and settlement paths audited for effective-stack
  handling first, so it is not part of WS-B.
- Switching cities requires re-signing the seamless-play permission. One grant
  covering the whole ladder would need `GamePermission` to carry a template set
  rather than a single id, which changes `GAME_PERMISSION_TYPEHASH`.
- Existing on-chain grants name `NLHE_HU_STANDARD_V2` and will report
  `permissionUpgradeRequired` until re-signed.
- Six-max templates exist only for Berlin and London, so the deeper cities have
  no Classic table to register against when that path moves over.
