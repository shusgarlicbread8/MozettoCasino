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
forge install OpenZeppelin/openzeppelin-contracts foundry-rs/forge-std --no-commit
forge build
forge test -vv
forge script script/DeployLocal.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
```
