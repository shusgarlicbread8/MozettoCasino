# Mozetto smart contracts (Foundry)

## Contracts

| Contract | Role |
|----------|------|
| `MockUSDC` | Anvil / local 6-decimal USDC |
| `ArenaVaultV1` | Player custody, seat locks, settlement |
| `TableRegistryV1` | Immutable table config + epochs |
| `PokerSettlementHubV1` | Attested epoch settlement (EIP-712 quorum) |
| `CheckpointRegistryV1` | Merkle history anchors |
| `RandomnessCoordinatorV1` | Seed-batch roots + mock VRF fulfill |

## USDC addresses

| Env | Chain ID | USDC |
|-----|----------|------|
| Anvil | 31337 | MockUSDC (deploy) |
| Base Sepolia | 84532 | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| Base Mainnet | 8453 | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |

## Commands

```bash
cd contracts
forge build
forge test -vv
# Local Anvil
anvil &
forge script script/DeployLocal.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
# Base Sepolia (set PRIVATE_KEY + RPC)
forge script script/DeploySepolia.s.sol --rpc-url $BASE_SEPOLIA_RPC_URL --broadcast --verify
```

Copy printed addresses into `.env.local` as `NEXT_PUBLIC_ARENA_VAULT_ADDRESS`, `CHECKPOINT_REGISTRY_ADDRESS`, etc.

## Mainnet gates (before real money)

- [ ] Smart-contract audit
- [ ] Fee treasury = Safe multisig
- [ ] Pause + withdrawal monitoring
- [ ] Independent settlement attestors
- [ ] Disable faucet (`NODE_ENV=production`)
- [ ] Legal / licensing approval
