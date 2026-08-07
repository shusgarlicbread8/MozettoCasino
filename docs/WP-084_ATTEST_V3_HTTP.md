# WP-084 follow-up — Attest-v3 HTTP (dealer + replay-verifier)

**Authority:** WP-084 Settlement worker V3 follow-up; WP-065 `@mozetto/attestors`  
**Prior:** `docs/WP-084_SETTLEMENT_WORKER_V3.md`, `docs/WP-065_ATTESTOR_SERVICES.md`  
**Date:** 2026-08-07  
**Label:** WP-084 follow-up (no new WP number)

---

## Delivered

| Item | Location |
|---|---|
| Dealer FinalSettlementV3 HTTP | `POST /v1/dealer/attest-v3` (`services/dealer`) |
| Replay FinalSettlementV3 HTTP | `POST /v1/attest-settlement-v3` (`services/replay-verifier`) |
| Shared JSON wire helpers | `@mozetto/attestors` `serializeFinalSettlementV3ForHttp` / `parseFinalSettlementV3FromHttp` |
| Worker HTTP adapters (V3 default) | `defaultV3HttpAdapters` in `services/settlement-worker/src/v3/attest.ts` |
| Tests | dealer / replay-verifier / attestors / settlement-worker |
| This note | `docs/WP-084_ATTEST_V3_HTTP.md` |

V2 endpoints retained for Anvil Hub V2 demos (`/v1/dealer/attest`, `/v1/verify-session`).

---

## Endpoints

### Dealer — `POST /v1/dealer/attest-v3`

- Signs with **`DEALER_ATTESTOR_PRIVATE_KEY` only** (never GAME/REPLAY/`SETTLEMENT_PRIVATE_KEY`).
- Body: FinalSettlementV3 JSON (bigint fields as decimal strings) — same shape as worker `serializeSettlementForHttp`.
- Response: `{ ok, signature, attestorAddress, digest, role: "dealer", eip712Version: "3", typehash }`.

### Replay-verifier — `POST /v1/attest-settlement-v3`

- Signs with **`REPLAY_ATTESTOR_PRIVATE_KEY` only**.
- Same body / response shape with `role: "replay"`.

Domain: `MozettoPokerSettlement` / version **`"3"`** / primary type `FinalSettlementV3`.

---

## Settlement-worker wiring

On the V3 settle path (`SETTLEMENT_HUB_V3_ADDRESS` or `SETTLEMENT_HUB_VERSION=v3`), `defaultV3HttpAdapters()` is enabled **by default**:

| Env | Effect |
|---|---|
| *(unset)* / `SETTLEMENT_V3_HTTP_ATTEST=1` | Wire HTTP adapters to V3 paths |
| `SETTLEMENT_V3_HTTP_ATTEST=0` | Disable HTTP adapters (local keys only) |
| `DEALER_URL` | Base URL (default `http://localhost:4003`) → `/v1/dealer/attest-v3` |
| `REPLAY_VERIFIER_URL` | Base URL (default `http://localhost:4004`) → `/v1/attest-settlement-v3` |

Local role keys (`GAME_` / `DEALER_` / `REPLAY_ATTESTOR_PRIVATE_KEY`) are still preferred when present; HTTP fills missing roles.

```bash
# Typical Anvil: local keys on worker — HTTP unused but available
SETTLEMENT_HUB_V3_ADDRESS=0x...
GAME_ATTESTOR_PRIVATE_KEY=...
DEALER_ATTESTOR_PRIVATE_KEY=...
REPLAY_ATTESTOR_PRIVATE_KEY=...

# Process-separated attestors: omit dealer/replay keys on worker
SETTLEMENT_HUB_V3_ADDRESS=0x...
GAME_ATTESTOR_PRIVATE_KEY=...
DEALER_URL=http://localhost:4003
REPLAY_VERIFIER_URL=http://localhost:4004
# SETTLEMENT_V3_HTTP_ATTEST=1   # default on V3 path
```

---

## Compatibility

| Path | Status |
|---|---|
| Hub V2 + `/v1/dealer/attest` + `/v1/verify-session` | Unchanged (Anvil demos) |
| Local `@mozetto/attestors` quorum on worker | Unchanged |
| Frozen `/specs` | Untouched |

---

## Commands

```bash
pnpm --filter @mozetto/attestors test
pnpm --filter @mozetto/dealer test
pnpm --filter @mozetto/replay-verifier test
pnpm --filter @mozetto/settlement-worker test
```
