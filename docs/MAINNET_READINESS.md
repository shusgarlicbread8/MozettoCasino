# Mainnet readiness checklist (Phase 8)

Do **not** deploy real-money Base Mainnet until every item is complete.

## Audits & review

- [ ] Independent smart-contract audit (vault, hub, registry, randomness)
- [ ] Independent poker-engine review (determinism, side pots, rake)
- [ ] Penetration test of API, game-server, indexer, admin
- [ ] Attestor-separation / key-custody review

## Keys & governance

- [ ] Protocol Admin Safe (3-of-5) + timelock for non-emergency changes
- [ ] Fee Treasury Safe (no game/settlement keys)
- [ ] Emergency Pauser role (cannot move funds)
- [ ] Relayer/paymaster: KMS, ETH ceiling, allowlist, rotation
- [ ] Attestor keys in KMS/HSM (game / replay / dealer)
- [ ] VRF subscription owner is not an ERC-4337 AA wallet

## Infrastructure

- [ ] Paid primary RPC + WebSocket + independent fallback
- [ ] Indexer leader election + lag alerts
- [ ] Reconciliation worker pages on vault/mirror mismatch
- [ ] Monitoring, incident runbooks, key-recovery drills

## Product & compliance

- [ ] Withdrawal and session limits
- [ ] Bug bounty program
- [ ] Licensing, AML/KYC, responsible gaming
- [ ] Restricted low-value mainnet beta

## Protocol honesty

Public copy must state:

> Funds and settlement are on-chain; card dealing is performed by an attested confidential dealer.

Do not claim live private cards are fully trustless until mental-poker / ZK dealer ships.

## Engineering phases completed before this gate

Phases 0–7 implement the Sepolia custody loop in-repo (manifest, session vault, indexer, seat tickets, dealer/VRF stubs, quorum settlement worker, agents, admin, Verify Match). This checklist is the **go/no-go** for Base Mainnet — not a substitute for the work above.
