# WP-052 — Mock VRF Anvil integration

**Authority:** Plan `05_RANDOMNESS_CONFIDENTIAL_DEALER_AND_DECK_PROOFS.md`, WP-052 in `16_AGENT_WORK_PACKETS.md`  
**Prior:** WP-050 `RandomnessBeaconV2` (`docs/WP-050_RANDOMNESS_BEACON_V2.md`) with `fulfillMock`  
**Date:** 2026-08-07

---

## Delivered

| Item | Location |
|---|---|
| Foundry lifecycle script | `contracts/script/MockVrfAnvil.s.sol` |
| Node Anvil E2E | `scripts/anvil-mock-vrf-beacon.mjs` |
| Orchestrator | `scripts/anvil-mock-vrf.sh` |
| pnpm entry | `pnpm e2e:mock-vrf` |
| This note | `docs/WP-052_MOCK_VRF_ANVIL.md` |

Does **not** mutate frozen `/specs`, Chainlink Sepolia (WP-053), or Nitro Enclave (WP-054). Avoids overlapping WP-025 invariant / WP-051 library authorship beyond consuming `@mozetto/dealer-deck` via optional `--with-deck`.

---

## Lifecycle (deterministic local path)

```text
SecretCommitted  →  VrfRequested  →  VrfFulfilled (mock)  →  DeckBatchRegistered
     commitSecretRoot   requestVrf      fulfillMock              registerDeckBatch
```

On Anvil, `DeployLocal.s.sol` deploys `RandomnessBeaconV2` with **`mockVrfEnabled=true`** and operator = deployer. Production / Sepolia leave mock off unless explicitly enabled.

Fixture salts (forge + node, keep in sync):

| Constant | Derivation |
|---|---|
| `sessionId` | `keccak256(MOCK_VRF_SESSION_SALT)` (default `wp052-session`) |
| `secretRoot` | `keccak256("wp052-dealer-secret-root:" ‖ salt)` |
| `vrfResult` | `keccak256("wp052-mock-vrf-result")` |
| fixture deck / attestation | `keccak256("wp052-deck-batch-root")` / `…-attestation` |

With `--with-deck`, secret + deck roots come from `@mozetto/dealer-deck` `prepareDeckBatch` using the same `vrfResult`.

---

## How to run

```bash
# One-shot: start Anvil if needed + forge script
bash scripts/anvil-mock-vrf.sh

# Redeploy full local stack first (writes anvil.json randomnessBeacon)
bash scripts/anvil-mock-vrf.sh --redeploy

# Node E2E (viem); optional dealer-deck roots
bash scripts/anvil-mock-vrf.sh --node
bash scripts/anvil-mock-vrf.sh --node --with-deck
pnpm e2e:mock-vrf
pnpm e2e:mock-vrf -- --with-deck

# Both forge + node
bash scripts/anvil-mock-vrf.sh --both

# Direct forge (Anvil already up)
cd contracts && forge script script/MockVrfAnvil.s.sol \
  --rpc-url http://127.0.0.1:8545 --broadcast -vv
```

**Re-runs on the same beacon:** secret roots and epochs are immutable. Set a fresh salt:

```bash
MOCK_VRF_SESSION_SALT=wp052-run-$(date +%s) pnpm e2e:mock-vrf
```

Or `--deploy-beacon` / omit `RANDOMNESS_BEACON_ADDRESS` to deploy a fresh mock-enabled beacon.

Last successful node run writes `scripts/.anvil-mock-vrf-last.json` (gitignored artifact).

---

## How dealers / services consume fulfillments locally

```text
Dealer (off-chain)                    RandomnessBeaconV2 (Anvil)
─────────────────                     ─────────────────────────
1. create secrets / secret leaves
2. dealerSecretRoot ────────────────► commitSecretRoot
3.                                  ► requestVrf
4.                                  ► fulfillMock(…, vrfResult)   ← mock only
5. read getEpoch().vrfResult
6. handSeedV2 / prepareDeckBatch(vrfR)
7. deckBatchRoot + attestation ─────► registerDeckBatch
8. hand-seed / open-public-card HTTP
   (services/dealer) using vrfWord =
   on-chain vrfResult
```

### Dealer service (`services/dealer`)

| Endpoint | Local mock VRF usage |
|---|---|
| `POST /v1/dealer/commit` | Builds `dealerRoot`; operator then commits that root on-chain |
| `POST /v1/dealer/hand-seed` | Pass `vrfWord` = `getEpoch(session, epoch).vrfResult` |
| `POST /v1/dealer/prepare-deck` | Same `vrfWord`; returns `deckRoot` for batch Merkle |
| `POST /v1/dealer/open-public-card` | Same binding; Merkle-opens a public card |

Library: `@mozetto/dealer-deck` (`prepareDeckBatch`, `handSeedV2`). Enclave delivery = WP-054.

### Settlement worker

`ENABLE_MOCK_VRF=1` still drives **legacy** `RandomnessCoordinatorV1.fulfillMock`. For Protocol V3 local paths, prefer Beacon V2 + this WP-052 script. Do not call `fulfillMock` on Sepolia/mainnet.

### Session lifecycle

WP-023 `beginRandomness` / `markReady` remain commitment + events only. Mirror beacon roots into lifecycle after each step; direct contract coupling is deferred.

---

## Env reference

| Variable | Role |
|---|---|
| `ANVIL_RPC_URL` | Default `http://127.0.0.1:8545` |
| `PRIVATE_KEY` | Operator (default Anvil #0) |
| `RANDOMNESS_BEACON_ADDRESS` | Existing beacon; else deploy / manifest |
| `MOCK_VRF_SESSION_SALT` | Deterministic session id salt |
| `MOCK_VRF_EPOCH` | Epoch u64 (default `1`) |
| `ENABLE_MOCK_VRF` | Legacy V1 settlement-worker only |

Manifest field: `packages/chain-manifest/deployments/anvil.json` → `randomnessBeacon`.

---

## Acceptance evidence

- `forge script script/MockVrfAnvil.s.sol --rpc-url http://127.0.0.1:8545 --broadcast` completes commit → mock fulfill → deck batch with `usedMockVrf=true`.
- `pnpm e2e:mock-vrf -- --deploy-beacon` verifies on-chain `DeckBatchRegistered`.
- `pnpm e2e:mock-vrf -- --with-deck --deploy-beacon` matches dealer-deck `deckBatchBind` to on-chain `DOMAIN_DECK_BATCH_V1`.
- Unit suite `RandomnessBeaconV2` (WP-050) remains the no-reroll gate (**19/19**).

Note: `forge script` compiles the script + beacon only. A full-repo `forge build` may still fail if unrelated WIP contracts (other wave packets) hit IR stack limits — that is outside WP-052.

---

## Out of scope / follow-up

| Packet | Topic |
|---|---|
| WP-051 | Dealer deck library authorship (consumed optionally here) |
| WP-053 | Chainlink VRF adapter (Sepolia) — see `docs/WP-053_CHAINLINK_VRF.md` |
| WP-054 | Nitro Enclave dealer |
| WP-055 | Randomness verifier CLI |
| — | Settlement-worker migration from V1 coordinator to Beacon V2 |
