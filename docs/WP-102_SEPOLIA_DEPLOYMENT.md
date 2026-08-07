# WP-102 — Base Sepolia deployment / chain-manifest

**Authority:** Phase 11 in `01_MASTER_EXECUTION_ROADMAP.md`, Sepolia gate in `14_ANVIL_SEPOLIA_MAINNET_TEST_AND_AUDIT_PLAN.md`, WP-102 in `16_AGENT_WORK_PACKETS.md`  
**Prior:** WP-100 Anvil E2E (`docs/WP-100_ANVIL_E2E.md`), WP-053 Chainlink VRF (`docs/WP-053_CHAINLINK_VRF.md`)  
**Date:** 2026-08-07

---

## Status

**Recipes ready; live tx pending ops.**

| Check | Result |
|---|---|
| `DeploySepolia.s.sol` V3 stack (registry, lifecycle, beacon, proof batch, hub V3, fee vault) | Ready |
| Chain-manifest Sepolia slot + codegen path | Ready (`protocolVersion: 2.0.0-sepolia`) |
| Env checklist (names only) | `.env.example` + below |
| Live broadcast | **Pending** — deployer must be a funded Base Sepolia key (not Anvil #0 with ~0 ETH) |
| Protocol addresses in `baseSepolia.json` | **Honest nulls** until broadcast |

Do **not** invent on-chain addresses. Manifest protocol fields stay `null` until `WRITE_CHAIN_MANIFEST=1` + `--broadcast` succeeds.

---

## Delivered

| Item | Location |
|---|---|
| V3 Sepolia deploy script | `contracts/script/DeploySepolia.s.sol` |
| Env gate / dry-run / broadcast | `scripts/sepolia-deploy.sh` → `pnpm sepolia:check\|dry-run\|deploy` |
| Basescan verify helper | `scripts/sepolia-verify.sh` → `pnpm sepolia:verify` |
| VRF adapter merge helper | `scripts/sepolia-merge-vrf-adapter.mjs` |
| Sepolia manifest slot | `packages/chain-manifest/deployments/baseSepolia.json` |
| Codegen | `pnpm --filter @mozetto/chain-manifest codegen` / `pnpm manifest:codegen` |
| Chainlink adapter (existing) | `contracts/script/DeployChainlinkVrfAdapter.s.sol` |
| This note | `docs/WP-102_SEPOLIA_DEPLOYMENT.md` |

Does **not** mutate frozen `/specs`, does **not** deploy mainnet, does **not** commit private keys.

---

## V3 contracts deployed by `DeploySepolia`

```text
MockUSDC (optional USE_MOCK_USDC=1) | Circle USDC (default)
ArenaVaultV1 + PokerSettlementHubV1          (legacy)
ProtocolFeeVault
ArenaAccount + ArenaAccountFactory
ArenaVaultV2
PokerSettlementHubV2
SignatureQuorumVerifier + VerifierRouter + PokerSettlementHubV3
TableRegistryV1
GameRegistryV2  (+ HU / six-max templates activated when GAME_REGISTRY_MIN_DELAY=0)
SessionLifecycleV2  (wired to vault + gameRegistry)
CheckpointRegistryV1
RandomnessCoordinatorV1
RandomnessBeaconV2  (ENABLE_MOCK_VRF=0 by default)
ProofBatchRegistryV1  (wired into Hub V3, requireProofBatch=false)
```

**Not in this script (follow-up):** `ChainlinkVrfAdapterV1` — deploy after funded VRF subscription (`DeployChainlinkVrfAdapter.s.sol`, WP-053), then:

```bash
node scripts/sepolia-merge-vrf-adapter.mjs 0xAdapter…
pnpm manifest:codegen
```

**Hub primary:** Vault `settlementHub` stays Hub V2 unless `SETTLEMENT_HUB_V3_AS_PRIMARY=1`. Manifest always records `settlementHubV2` / `settlementHubV3` explicitly; `settlementHub` mirrors the vault primary.

---

## Env checklist (names only)

### Required for live broadcast

| Name | Purpose |
|---|---|
| `PRIVATE_KEY` | Deployer EOA (must hold Base Sepolia ETH) |
| `BASE_SEPOLIA_RPC_URL` | Base Sepolia RPC (`84532`); `SEPOLIA_RPC_URL` accepted as alias |

### Strongly recommended

| Name | Purpose |
|---|---|
| `BASESCAN_API_KEY` | `--verify` / `pnpm sepolia:verify` |
| `FEE_TREASURY_ADDRESS` | Ultimate fee recipient (defaults to deployer) |

### Deploy posture

| Name | Default / note |
|---|---|
| `USE_MOCK_USDC` | `0` — Circle USDC; `1` for labelled mUSDC faucet staging |
| `ENABLE_MOCK_VRF` | `0` on Sepolia |
| `SETTLEMENT_HUB_V3_AS_PRIMARY` | `0` unless cutover intended |
| `WRITE_CHAIN_MANIFEST` | Set only by `pnpm sepolia:deploy` (prevents dry-run fake addrs) |
| `PROTOCOL_FEE_VAULT_MIN_DELAY` | `1 days` |
| `PROOF_BATCH_REGISTRY_MIN_DELAY` | `1 days` |
| `GAME_REGISTRY_MIN_DELAY` | `0` for in-script template activation; raise post-deploy |
| `ATTESTOR_1/2/3_ADDRESS` | Optional extra attestors |
| `ATTESTOR_MIN_SIGNATURES` | Staging `1`; raise toward `3` before WP-103 |

### VRF adapter (after core deploy)

| Name | Purpose |
|---|---|
| `RANDOMNESS_BEACON_ADDRESS` | From manifest |
| `VRF_SUBSCRIPTION_ID` | Funded Chainlink VRF v2.5 sub |
| `VRF_COORDINATOR` / `VRF_KEY_HASH` | Defaults in WP-053 / manifest |

### Post-deploy service wiring (consume manifest; env overrides optional)

`ARENA_VAULT_ADDRESS`, `ARENA_ACCOUNT_FACTORY_ADDRESS`, `GAME_REGISTRY_ADDRESS`, `SESSION_LIFECYCLE_ADDRESS`, `SETTLEMENT_HUB_V3_ADDRESS`, `PROOF_BATCH_REGISTRY_ADDRESS`, `PROTOCOL_FEE_VAULT_ADDRESS`, `RANDOMNESS_BEACON_ADDRESS`, `CHAINLINK_VRF_ADAPTER_ADDRESS`, `DEPLOYMENT_BLOCK`, plus `NEXT_PUBLIC_*` mirrors as needed. Prefer `@mozetto/chain-manifest` over scattering addresses.

---

## Commands

```bash
# 1) Env + balance gate (no secrets printed)
pnpm sepolia:check

# 2) Simulate DeploySepolia against RPC (no WRITE_CHAIN_MANIFEST → no JSON overwrite)
pnpm sepolia:dry-run

# 3) Live broadcast + write baseSepolia.json + codegen (ops only when funded)
pnpm sepolia:deploy

# 4) Basescan verify from manifest (best-effort; prefer --verify on broadcast)
pnpm sepolia:verify

# 5) Chainlink adapter (WP-053)
cd contracts
forge script script/DeployChainlinkVrfAdapter.s.sol \
  --rpc-url $BASE_SEPOLIA_RPC_URL --broadcast --verify -vv
cd ..
node scripts/sepolia-merge-vrf-adapter.mjs 0x…
pnpm manifest:codegen
```

Manual equivalent:

```bash
cd contracts
WRITE_CHAIN_MANIFEST=1 forge script script/DeploySepolia.s.sol:DeploySepolia \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" --broadcast --verify -vv
```

---

## Manifest schema (Sepolia slot)

`packages/chain-manifest/deployments/baseSepolia.json` fields consumed by codegen:

| Field | Pre-live | Post-broadcast |
|---|---|---|
| `chainId` | `84532` | same |
| `usdc` / `symbol` / decimals / flags | Circle USDC defaults (or mUSDC if mock) | from deploy |
| Protocol addresses | `null` | hex |
| `chainlinkVrfAdapter` | `null` until WP-053 adapter deploy | hex |
| `vrfCoordinator` / `vrfKeyHash` | Chainlink Base Sepolia constants | same |
| `protocolVersion` | `2.0.0-sepolia` | same |
| `deploymentBlock` | `0` | on-chain block |

Codegen ignores undocumented `_status` / `_note` bookkeeping keys.

---

## Sepolia deployment gate (Plan 14) — checklist

Before ops broadcast:

- [x] Deploy script produces manifest automatically (`WRITE_CHAIN_MANIFEST=1`)
- [x] Roles can use distinct staging keys (`ATTESTOR_*`, `FEE_TREASURY_ADDRESS`)
- [ ] Deployer funded with Base Sepolia ETH
- [ ] VRF subscription created + funded (for adapter step)
- [ ] Hosted dealer / replay / indexer / worker ready (WP-086 recipes)
- [ ] Staging Supabase migrations applied
- [ ] Public environment labelled **testnet**
- [ ] Internal review of V3 contracts (audit-oriented) as required by gate

---

## Exit criteria → WP-103 (Public testnet program)

WP-102 is **DONE** for recipes when the above artifacts exist. WP-103 may start team-only (Stage A) only after:

1. `pnpm sepolia:deploy` succeeds on a funded ops key  
2. `baseSepolia.json` has non-null V3 addresses + `pnpm manifest:codegen` committed  
3. Basescan verification for core contracts (or documented retry)  
4. Chainlink adapter deployed, consumer added, `chainlinkVrfAdapter` merged  
5. Attestor quorum raised toward 3-of-N with distinct keys  
6. Hosted stack pointed at manifest; smoke: fund → lock → settle → withdraw on test assets  
7. Public Verify Game + indexer reindex against Sepolia `deploymentBlock`

Then WP-103 Stages A→B→C per Plan 14 (weeks, not hours).

---

## Acceptance evidence (this packet)

```text
pnpm sepolia:check
→ PRIVATE_KEY + BASE_SEPOLIA_RPC_URL present in local env
→ balance_gate=FAIL for Anvil default key (~0 ETH) → live tx deferred
forge build (DeploySepolia compiles)
pnpm manifest:codegen → baseSepolia protocol addresses remain null
```

---

## Security notes

- Never commit `PRIVATE_KEY`, attestor keys, or `.env.local`.  
- Do not use Anvil default keys on public networks with value.  
- `WRITE_CHAIN_MANIFEST` prevents dry-run simulated addresses from becoming “truth”.  
- Mainnet (`8453`) remains forbidden until WP-105 gates.

---

## Follow-up

- Ops go-live sequence: `docs/WAVE_13_STAGE_A_GO_LIVE.md` (non-Anvil key → fund ≥0.05 ETH → deploy → verify → VRF → attestors → hosted → `pnpm testnet:stage-a-gate`).  
- WP-103 public testnet program (Stage A after gate PASS).  
- Raise GameRegistry / fee-vault / proof-batch delays and attestor quorum for staging hardening.  
- `scripts/sepolia-deploy.sh` refuses Anvil `#0`–`#9` for live Sepolia broadcast.
