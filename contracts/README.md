# Mozetto smart contracts (Foundry)

**Product freeze:** Until deposit → lock → play → settle → withdraw works on Base Sepolia, do not expand casino/tournament/shop surfaces. This stack is **on-chain-custodied and settled poker with verifiable off-chain execution** — not fully trustless mental poker.

## Truth-source hierarchy

| Information | Authoritative source |
|-------------|----------------------|
| Actual USDC held | `ArenaVault` on Base |
| Available / session-locked balances | `ArenaVault` |
| Game templates / rake | `TableRegistry` (immutable templates) |
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
| `ArenaVaultV1` | Custody, EIP-712 `SeatTicket` batch `openSession`, settle, emergency exit |
| `TableRegistryV1` | Immutable game templates |
| `PokerSettlementHubV1` | Attested session settlement (EIP-712 quorum) |
| `CheckpointRegistryV1` | Merkle history anchors |
| `RandomnessCoordinatorV1` | Dealer seed roots + VRF / mock fulfill |

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
forge script script/DeploySepolia.s.sol --rpc-url $BASE_SEPOLIA_RPC_URL --broadcast --verify
```

## Mainnet gates (Phase 8)

See [`docs/MAINNET_READINESS.md`](../docs/MAINNET_READINESS.md).
