# WP-053 — Chainlink VRF adapter (Sepolia)

**Authority:** Plan `05_RANDOMNESS_CONFIDENTIAL_DEALER_AND_DECK_PROOFS.md`, WP-053 in `16_AGENT_WORK_PACKETS.md`  
**Prior:** WP-050 `RandomnessBeaconV2`; WP-052 Mock VRF Anvil (`docs/WP-052_MOCK_VRF_ANVIL.md`)  
**Date:** 2026-08-07

---

## Delivered

| Item | Location |
|---|---|
| `ChainlinkVrfAdapterV1` | `contracts/src/ChainlinkVrfAdapterV1.sol` |
| Minimal VRF v2.5 interfaces + encoding | `contracts/src/vrf/` (`IVRFCoordinatorV2Plus`, `VRFV2PlusClient`, consumer iface) |
| Foundry mock coordinator | `contracts/src/vrf/MockVRFCoordinatorV2Plus.sol` |
| Foundry suite | `contracts/test/ChainlinkVrfAdapterV1.t.sol` |
| Sepolia deploy script | `contracts/script/DeployChainlinkVrfAdapter.s.sol` |
| Manifest defaults | Base Sepolia coordinator + 30 gwei key hash (corrected to Chainlink docs) |
| This note | `docs/WP-053_CHAINLINK_VRF.md` |

Does **not** mutate frozen `/specs`, Nitro Enclave (WP-054), or Anvil mock scripts (WP-052). Unit tests use the mock coordinator — **no live Chainlink subscription or keys**.

---

## Lifecycle (Sepolia / production path)

```text
SecretCommitted
  → adapter.requestRandomness(sessionId, epoch)
       Chainlink requestRandomWords
       beacon.requestVrf + bindExternalRequestId(chainlinkRequestId)
  → coordinator callback rawFulfillRandomWords
       adapter → beacon.fulfillVrf(requestId, bytes32(word))
  → registerDeckBatch (operator / owner)
```

Alternate: operator already called `beacon.requestVrf` → `adapter.requestChainlinkForPendingEpoch` (bind only).

Anvil remains: `fulfillMock` via WP-052 (`pnpm e2e:mock-vrf`). Leave `mockVrfEnabled=false` on Sepolia.

---

## Request tracking

| Store | Key | Value |
|---|---|---|
| Adapter `requests` | Chainlink `requestId` | `sessionId`, `randomnessEpoch`, `epochKey`, `bindingHash`, fulfilled |
| Adapter `epochKeyToRequestId` | `epochKey` | Chainlink `requestId` (one per epoch) |
| Beacon `requestIdToEpochKey` | same Chainlink id (after bind) | epoch key |

Re-request of the same epoch reverts (`AlreadyRequested` / beacon `AlreadyRequested`). Second fulfill reverts. Zero word rejected.

---

## Base Sepolia config (VRF v2.5)

Source: [Chainlink VRF v2.5 supported networks — BASE Sepolia](https://docs.chain.link/vrf/v2-5/supported-networks#base-sepolia-testnet)

| Item | Value |
|---|---|
| Chain ID | `84532` |
| VRF Coordinator | `0x5C210eF41CD1a72de73bF76eC39637bB0d3d7BEE` |
| 30 gwei key hash | `0x9e1344a1247c8a1785d0a4681a27152bffdb43666ae5bf7d14d24a5efd44bf71` |
| LINK (test) | `0xE4aB69C077896252FAFBD49EFD26B5D171A32410` |
| Min confirmations | `0` (script default `3`) |
| Max gas limit | `2_500_000` |

**Manifest:** `@mozetto/chain-manifest` defaults for `baseSepolia.vrfCoordinator` / `vrfKeyHash` match the table above. After deploy, merge `chainlinkVrfAdapter` into `packages/chain-manifest/deployments/baseSepolia.json` and run `pnpm --filter @mozetto/chain-manifest codegen`.

### Env (deploy / ops)

```bash
# Required for DeployChainlinkVrfAdapter.s.sol
PRIVATE_KEY=...
RANDOMNESS_BEACON_ADDRESS=0x...   # from DeploySepolia / manifest
VRF_SUBSCRIPTION_ID=...           # create + fund at vrf.chain.link

# Optional overrides
VRF_COORDINATOR=0x5C210eF41CD1a72de73bF76eC39637bB0d3d7BEE
VRF_KEY_HASH=0x9e1344a1247c8a1785d0a4681a27152bffdb43666ae5bf7d14d24a5efd44bf71
VRF_CALLBACK_GAS_LIMIT=500000
VRF_REQUEST_CONFIRMATIONS=3
VRF_NATIVE_PAYMENT=0              # 1 = pay with Sepolia BASE ETH
VRF_ADAPTER_OPERATOR=0x...        # defaults to deployer
ENABLE_MOCK_VRF=0                 # Sepolia DeploySepolia posture
```

### Deploy steps

1. Deploy stack with `DeploySepolia.s.sol` (`ENABLE_MOCK_VRF=0`).
2. Create a VRF v2.5 subscription on Base Sepolia; fund with LINK (or plan native payment).
3. Deploy adapter:

```bash
cd contracts
forge script script/DeployChainlinkVrfAdapter.s.sol \
  --rpc-url $BASE_SEPOLIA_RPC_URL --broadcast -vv
```

4. **Add the adapter address as a consumer** on the subscription (Chainlink UI or coordinator `addConsumer`).
5. Record address in chain-manifest; set `CHAINLINK_VRF_ADAPTER_ADDRESS` for local overrides if needed.

The deploy script logs the adapter address. Merge `chainlinkVrfAdapter` into `packages/chain-manifest/deployments/<network>.json` manually, then run `pnpm --filter @mozetto/chain-manifest codegen`.

---

## Base mainnet notes

| Item | Value |
|---|---|
| VRF Coordinator | `0xd5D517aBE5cF79B7e95eC98dB0f0277788aFF634` |
| 2 gwei key hash (example) | `0x00b81b5a830cb0a4009fbd8904de511e28631e62ce5ad231373d3cdad373ccab` |

Pass `VRF_COORDINATOR` / `VRF_KEY_HASH` explicitly for mainnet. Do not enable mock VRF.

---

## How to test (no live keys)

```bash
cd contracts
forge test --match-contract ChainlinkVrfAdapterV1 -vv
```

Mock coordinator `fulfill(requestId, words)` drives `rawFulfillRandomWords` → beacon. Anvil mock path unchanged:

```bash
pnpm e2e:mock-vrf
```

---

## Compatibility

| Path | Status |
|---|---|
| WP-052 Anvil mock | Untouched (`MockVrfAnvil.s.sol`, `e2e:mock-vrf`) |
| `RandomnessBeaconV2` | Unchanged API; adapter uses `requestVrf` / `bindExternalRequestId` / `fulfillVrf` |
| `RandomnessCoordinatorV1` | Untouched (legacy) |
| Frozen `/specs` | Untouched |
| Nitro Enclave | Out of scope (WP-054) |

---

## Follow-up

- Wire settlement-worker / dealer ops to call `requestRandomness` after secret commit on Sepolia  
- WP-054 Nitro Enclave dealer  
- WP-055 randomness verifier CLI  
- Optional dual-operator helper so dealer EOA commits while adapter only fulfills
