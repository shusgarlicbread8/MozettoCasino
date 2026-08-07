# WP-064 — Replay verifier service

**Authority:** Plan `10_EVENT_LOG_PROOF_BATCHING_SETTLEMENT_AND_VERIFICATION.md` (Replay verifier), WP-060 `@mozetto/event-store`  
**Date:** 2026-08-07  
**Status:** DONE

---

## Delivered

| Item | Location |
|---|---|
| PokerEventV1 chain verify (TS) | `services/replay-verifier/src/verify.ts` |
| HTTP service (legacy + V1) | `services/replay-verifier/src/index.ts` |
| Rust CLI `verify-events` | `crates/poker-replay` (`event_chain.rs`) |
| Unit tests (TS) | `services/replay-verifier/src/replay-verifier.test.ts` |
| Unit tests (Rust) | `crates/poker-replay/src/event_chain.rs` (`#[cfg(test)]`) |
| This note | `docs/WP-064_REPLAY_VERIFIER.md` |

No SettlementHubV3 ownership (WP-063). Specs untouched. Legacy JSON path retained.

---

## What it verifies

Independent of the game-server / Mozetto API trust boundary:

1. **PokerEventV1 hash chain** — recompute ABI `eventHash` (protocol-vectors / event-store); check `previousEventHash` continuity from `bytes32(0)`.
2. **Settlement proposal** — `eventRoot` must equal chain tip; `finalSequence` must equal last event sequence. Divergent proposals are rejected (no attestor signature when `requireProposalMatch`).
3. **Divergent transcripts** — elapsedMs / prev-hash / stored-hash mutations fail with `HASH_MISMATCH` / `PREV_BREAK` / `PROPOSAL_*`.
4. **Legacy coexistence** — `schema_kind=legacy_json` still verified via GENESIS-linked JSON keccak (`@mozetto/game-rules`).
5. **Optional engine fixtures** — existing WP-035 path unchanged: `poker-replay verify <fixtures>`.

---

## Schemas

| `schema_kind` | Genesis / prev tip | Hash source |
|---|---|---|
| `poker_event_v1` | `bytes32(0)` | ABI `MOZETTO_EVENT_V1` encode |
| `legacy_json` | `GENESIS_EVENT_HASH` | Stable JSON keccak (`mozetto-poker-v1`) |

DB rows from migration `019` carry `schema_kind`. Mixed transcripts are treated as V1 and fail unless fully consistent.

---

## Service API

```bash
pnpm --filter @mozetto/replay-verifier dev   # :4004
```

| Route | Role |
|---|---|
| `POST /v1/verify-session` | Load `canonical_game_events` + optional `settlement_proposals`; verify; optionally sign |
| `POST /v1/verify-transcript` | Offline body (no DB) — tests / public verify package |
| `GET /health` | `{ workPacket: "WP-064", schemas: [...] }` |

`requireProposalMatch` (default `true`) refuses to sign when proposal roots diverge.

---

## Rust CLI

```bash
# Golden PokerEventV1 vectors 03 / 04 (+ honest proposal)
cargo run -q -p poker-replay -- verify-events --golden 03
cargo run -q -p poker-replay -- verify-events --golden 04

# Arbitrary transcript JSON
cargo run -q -p poker-replay -- verify-events path/to/transcript.json

# WP-035 engine fixtures (unchanged)
cargo run -q -p poker-replay -- verify packages/game-rules/fixtures
# or:
pnpm test:poker-replay
pnpm test:poker-replay:events
```

### Transcript.json shape

```json
{
  "schemaKind": "poker_event_v1",
  "expectedTip": "0x…",
  "events": [ { "protocolVersion": 3, "sessionId": "0x…", "…": "…" } ],
  "settlementProposal": {
    "finalSequence": 5,
    "eventRoot": "0x…"
  }
}
```

Exit `0` = PASS, `1` = FAIL.

---

## Tests / evidence

```bash
pnpm --filter @mozetto/replay-verifier test
pnpm --filter @mozetto/replay-verifier typecheck
cargo test -p poker-replay
cargo run -q -p poker-replay -- verify-events --golden 03
pnpm test:poker-replay
```

---

## Out of scope / follow-up

| Item | Packet |
|---|---|
| SettlementHubV3 / VerifierRouter | WP-063 |
| HandRoot / BalanceRoot rebuild in service | WP-061 |
| Attestor key topology (A/B split) | WP-065 |
| Persist-before-broadcast cutover | WP-081 |
| Full engine replay from PokerEventV1 action stream | later (fixtures cover NLHE via WP-035) |

---

## Spec links

- `specs/MOZETTO_POKER_EVENT_V1.md` §§4, 11
- Plan 10 — Replay verifier receives events + settlement proposal; signs only if all match
- Vectors `03_preflop_sequence.json`, `04_incomplete_allin_raise.json`
