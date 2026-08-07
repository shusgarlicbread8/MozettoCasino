# Mozetto smart contracts (Foundry)

**Product freeze:** Until deposit → lock → play → settle → withdraw works on Base Sepolia, do not expand casino/tournament/shop surfaces. This stack is **on-chain-custodied and settled poker with verifiable off-chain execution** — not fully trustless mental poker.

## Truth-source hierarchy

| Information | Authoritative source |
|-------------|----------------------|
| Actual USDC held | `ArenaVault` on Base |
| Available / session-locked balances | `ArenaVault` |
| Game templates / rake | `GameRegistryV2` (V3 templates); `TableRegistryV1` legacy |
| Live hand state | Game-server event log |
| Private cards | Confidential dealer |
| Randomness provenance | Dealer commitment + VRF |
| Final payouts | Settlement hub → vault |
| UI balances / history | Supabase mirror (projection only) |

Supabase must **never** be the final authority over real money.

## Contracts

| Contract | Role |
|----------|------|
| `MockUSDC` | Anvil / local 6-decimal USDC |
| `ArenaAccount` / `ArenaAccountFactory` | Per-owner gaming custody + CREATE2 factory; GamePermission caps + owner revoke |
| `ArenaVaultV2` | ArenaAccount-only session lock/settle; V2 SeatTicket + additive SeatTicketV3 / `sealAndFundSession`; optional GameRegistry + SessionLifecycle hooks |
| `PokerSettlementHubV2` | Attested settlement into ArenaVaultV2 (EIP-712 `"2"`; default vault hub for demos) |
| `PokerSettlementHubV3` | FinalSettlementV3 + VerifierRouter quorum into ArenaVaultV2 (EIP-712 `"3"`) |
| `VerifierRouter` / `SignatureQuorumVerifier` | Pluggable settlement proof policy (Season 1 = signature quorum) |
| `ArenaVaultV1` | Legacy custody (kept for historical sessions) |
| `TableRegistryV1` | Immutable game templates (V1 / legacy) |
| `GameRegistryV2` | GameTemplateV2 registry — sealed body, timelocked activate/deactivate |
| `SessionLifecycleV2` | SESSION_V2 state machine (DRAFT→…→SETTLED / ABORTED / EMERGENCY_EXIT) |
| `ProtocolFeeVault` | Fee-only rake accumulator; sweep → Treasury Safe (timelocked treasury updates) |
| `PokerSettlementHubV1` | Legacy attested settlement |
| `CheckpointRegistryV1` | Per-session Merkle history anchors |
| `ProofBatchRegistryV1` | Global proof-batch roots (sequence continuity + publisher role) |
| `RandomnessCoordinatorV1` | Dealer seed roots + VRF / mock fulfill (legacy) |
| `RandomnessBeaconV2` | MOZETTO_RANDOMNESS_V2: secret-root → VRF bind → deck-batch (no reroll) |
| `ChainlinkVrfAdapterV1` | Chainlink VRF v2.5 consumer → beacon fulfill (Sepolia; mock Anvil = WP-052) |

**Custody review (WP-020):** see [`docs/WP-020_CUSTODY_GAP_ANALYSIS.md`](../docs/WP-020_CUSTODY_GAP_ANALYSIS.md) for Plan 03 → V2 mapping, intentional deferrals, and hardenings.

**SeatTicket V3 (WP-021):** see [`docs/WP-021_SEAT_TICKET_V3.md`](../docs/WP-021_SEAT_TICKET_V3.md) for atomic `sealAndFundSession`, V2 coexistence, and intentional deltas.

**GameRegistryV2 (WP-022):** see [`docs/WP-022_GAME_REGISTRY_V2.md`](../docs/WP-022_GAME_REGISTRY_V2.md) for timelocked template lifecycle and frozen GameTemplateV2 hashing.

**Session lifecycle (WP-023):** see [`docs/WP-023_SESSION_LIFECYCLE.md`](../docs/WP-023_SESSION_LIFECYCLE.md) for SESSION_V2 state machine, seal immutability, and vault/registry coordination.

**ProtocolFeeVault (WP-024):** see [`docs/WP-024_PROTOCOL_FEE_VAULT.md`](../docs/WP-024_PROTOCOL_FEE_VAULT.md) for fee-only accrual, restricted sweep, and settlement destination constraints. Plan 11 rake / unit economics / treasury mapping: [`docs/PLAN_11_RAKE_TREASURY.md`](../docs/PLAN_11_RAKE_TREASURY.md).

**Contract invariants (WP-025):** see [`docs/WP-025_CONTRACT_INVARIANTS.md`](../docs/WP-025_CONTRACT_INVARIANTS.md) for Foundry invariant/fuzz suite and agreed run count (256; extended 1000).

```bash
cd contracts
forge test --match-contract CustodyInvariantsTest
FOUNDRY_INVARIANT_RUNS=1000 forge test --match-contract CustodyInvariantsTest
```

**RandomnessBeaconV2 (WP-050):** see [`docs/WP-050_RANDOMNESS_BEACON_V2.md`](../docs/WP-050_RANDOMNESS_BEACON_V2.md) for secret-root/VRF binding, no-reroll rules, and mock VRF.

**Mock VRF Anvil (WP-052):** deterministic commit → `fulfillMock` → deck-batch path — [`docs/WP-052_MOCK_VRF_ANVIL.md`](../docs/WP-052_MOCK_VRF_ANVIL.md); `forge script script/MockVrfAnvil.s.sol` or `pnpm e2e:mock-vrf`.

**Chainlink VRF adapter (WP-053):** Sepolia VRF v2.5 consumer + request tracking — [`docs/WP-053_CHAINLINK_VRF.md`](../docs/WP-053_CHAINLINK_VRF.md); `forge test --match-contract ChainlinkVrfAdapterV1`; deploy `script/DeployChainlinkVrfAdapter.s.sol`.

**ProofBatchRegistryV1 (WP-062):** global proof-batch anchoring — [`docs/WP-062_PROOF_BATCH_REGISTRY.md`](../docs/WP-062_PROOF_BATCH_REGISTRY.md); `forge test --match-contract ProofBatchRegistryV1`; Anvil stub `pnpm e2e:proof-batch` / `script/PublishProofBatchAnvil.s.sol`.

**SettlementHubV3 (WP-063):** FinalSettlementV3 + VerifierRouter — [`docs/WP-063_SETTLEMENT_HUB_V3.md`](../docs/WP-063_SETTLEMENT_HUB_V3.md); `forge test --match-contract PokerSettlementHubV3`; optional `SETTLEMENT_HUB_V3_AS_PRIMARY=1` on DeployLocal/Sepolia.

**Emergency exit (WP-066):** Checkpoint balance-leaf claim — [`docs/WP-066_EMERGENCY_EXIT.md`](../docs/WP-066_EMERGENCY_EXIT.md); `ArenaVaultV2.emergencyExitWithBalanceLeaf`; `forge test --match-contract EmergencyExitV3Test`.

## Environments

| Env | Chain ID | USDC |
|-----|----------|------|
| Anvil | 31337 | MockUSDC (deploy) |
| Base Sepolia | 84532 | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| Base Mainnet | 8453 | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |

## Chain manifest

Deploy scripts write `packages/chain-manifest/deployments/<network>.json`. Regenerate TypeScript:

```bash
pnpm --filter @mozetto/chain-manifest codegen
```

All services must consume `@mozetto/chain-manifest` — do not scatter addresses across env files as the sole source of truth (env overrides are for local iteration only).

## Commands

```bash
cd contracts
forge build
forge test -vv
anvil &
forge script script/DeployLocal.s.sol --rpc-url http://127.0.0.1:8545 --broadcast

# Base Sepolia V3 (WP-102) — prefer repo recipes (env check / dry-run / broadcast)
pnpm sepolia:check
pnpm sepolia:dry-run
# Live (funded deployer + PRIVATE_KEY + BASE_SEPOLIA_RPC_URL):
pnpm sepolia:deploy
pnpm sepolia:verify
# Or manually:
# WRITE_CHAIN_MANIFEST=1 forge script script/DeploySepolia.s.sol \
#   --rpc-url $BASE_SEPOLIA_RPC_URL --broadcast --verify
# Then: forge script script/DeployChainlinkVrfAdapter.s.sol (WP-053)
```

See [`docs/WP-102_SEPOLIA_DEPLOYMENT.md`](../docs/WP-102_SEPOLIA_DEPLOYMENT.md).

## Restricted Base Mainnet (WP-105)

Recipes / gates only — **no live broadcast** until Plan 14 readiness + `finalGateApproval`.

```bash
pnpm mainnet:gate              # expected FAIL until GATES.json all true
pnpm mainnet:check-manifest -- --honesty
pnpm mainnet:check             # refuses broadcast
# pnpm mainnet:deploy          # hard-refused until gate + stub cutover
```

See [`docs/WP-105_RESTRICTED_MAINNET.md`](../docs/WP-105_RESTRICTED_MAINNET.md). Manifest slot: `packages/chain-manifest/deployments/base.json` (honest nulls).

## Mainnet gates (Phase 8)

See [`docs/MAINNET_READINESS.md`](../docs/MAINNET_READINESS.md) and WP-105 above.
