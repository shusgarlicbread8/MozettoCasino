# 17 — Final Definition of Done

Mozetto is not “done” because the UI works or one happy-path game settles. The following checklist defines protocol completion for the first restricted mainnet release.

## Protocol

- [ ] All canonical specs are frozen and published.
- [ ] TS/Rust/Solidity protocol vectors match.
- [ ] Active sessions bind immutable protocol, template, engine, model, profile, Energy, randomness, and settlement policy hashes.
- [ ] Historical versions remain verifiable.

## Custody

- [ ] Idle USDC is held in user ArenaAccounts.
- [ ] Owner alone can withdraw idle funds.
- [ ] GamePermission is capped, expiring, and revocable.
- [ ] Session signer cannot make arbitrary transfers.
- [ ] Entire buy-in is atomically locked before play.
- [ ] Settlement can pay only sealed ArenaAccounts and ProtocolFeeVault.
- [ ] Vault solvency invariant is continuously reconciled.
- [ ] Emergency exit works from accepted checkpoints.

## Matchmaking/session

- [ ] Ranked users cannot select exact public opponents/tables.
- [ ] Self-match and linked-seat controls work.
- [ ] Participant/seat/controller roots freeze at seal.
- [ ] No new player enters an active hand.
- [ ] Join/leave/top-up changes use new epochs.
- [ ] VRF request occurs only after seal.

## Randomness/dealer

- [ ] Dealer secret root precedes VRF.
- [ ] VRF request cannot be rerolled/cancelled.
- [ ] Hand seeds and shuffle are deterministic and unbiased.
- [ ] Deck batches are committed.
- [ ] Revealed cards have valid Merkle proofs.
- [ ] Folded cards remain private.
- [ ] Dealer enclave attestation is publicly inspectable.
- [ ] Conflicting deck roots cannot be accepted.

## Poker engine

- [ ] HU and six-max NLHE rules are complete.
- [ ] Side pots, incomplete raises, odd chips, all-ins, and blinds are covered.
- [ ] Engine has no I/O/nondeterminism/floating point.
- [ ] TS/Rust/PokerKit differential tests pass.
- [ ] Replay reaches identical final state hash.
- [ ] Rust build is reproducible before it becomes canonical.

## AI

- [ ] Ranked Season 1 uses only Groq `openai/gpt-oss-120b`.
- [ ] Exact model policy is pinned and hashed.
- [ ] One master policy and bounded profile configs are used.
- [ ] No arbitrary prompts/external tools/solvers.
- [ ] Each seat receives only its legitimate private/public information.
- [ ] Structured outputs are validated.
- [ ] Deterministic fallback cannot freeze a hand.
- [ ] Profile separation is measured.
- [ ] Provider capacity and retention/security terms are understood.

## Continuous cognition/Energy

- [ ] Each seat starts every hand at 100 Energy.
- [ ] Unused Energy expires.
- [ ] Final-action reserve is enforced.
- [ ] Background cognition is event-driven and bounded.
- [ ] AgentState is structured, private, and pruned.
- [ ] Public timing is separate from provider latency.
- [ ] Final action meets 15-second deadline.
- [ ] Energy ledger is auditable.

## Events/proofs/settlement

- [ ] Every canonical event is hash-linked.
- [ ] Persist-before-broadcast is enforced.
- [ ] Hand, balance, and proof-batch roots are generated.
- [ ] Proof batches are anchored on Base.
- [ ] Replay verifier independently reproduces final state.
- [ ] Settlement uses configured quorum/verifier.
- [ ] Funds and rake conserve exactly.
- [ ] Altered actions/cards/balances/recipients are rejected.
- [ ] Public Verify Game package is complete.

## Economics

- [ ] Users see only published capped rake.
- [ ] No hidden AI/performance fee.
- [ ] No-flop-no-drop and cap rules are frozen in template.
- [ ] AI, chain, dealer, and infrastructure COGS are measured.
- [ ] Proposed mainnet rake has a documented unit-economic basis.
- [ ] Protocol fees are segregated from player liabilities.

## Ratings/integrity

- [ ] HU rating belongs to user account.
- [ ] New agents cannot reset rating.
- [ ] Rating updates only after verified settlement.
- [ ] Stake size does not buy more rating points.
- [ ] Pair caps and identity controls work.
- [ ] Aggression score is descriptive and sample-adjusted.
- [ ] No live coaching/profile changes.
- [ ] Spectator/private-data policy is enforced.

## Infrastructure

- [ ] Exactly one table actor writes state.
- [ ] Table recovery from durable event log works.
- [ ] Redis loss does not corrupt canonical state.
- [ ] Indexer rebuild from deployment block works.
- [ ] RPC redundancy and reorg handling are tested.
- [ ] Hosted API/game/dealer/verifier/indexer/worker are deployed separately from Vercel.
- [ ] Monitoring and alerts cover all critical paths.

## Governance/admin

- [ ] No super-admin private key exists.
- [ ] Protocol Safe and timelock are live.
- [ ] Treasury Safe is separate.
- [ ] Relayer/attestor/dealer keys are separated and protected.
- [ ] Emergency guardian is narrowly scoped.
- [ ] Admin cannot edit balances/results.
- [ ] Critical reconciliation mismatch auto-pauses new sessions.
- [ ] Incident runbooks and key rotation drills are complete.

## Testing/audit

- [ ] Clean Anvil E2E is repeatable.
- [ ] Full chaos suite passes safely.
- [ ] Public Sepolia test ran for a sustained period.
- [ ] Public/adversarial test program completed.
- [ ] Smart-contract audit closed critical/high findings.
- [ ] Poker-engine review completed.
- [ ] Dealer/randomness review completed.
- [ ] Wallet/backend security review completed.
- [ ] Mainnet bytecode matches reviewed release.

## Mainnet launch constraints

- [ ] One game template.
- [ ] One standardized model.
- [ ] Low maximum buy-in.
- [ ] Limited cohort/concurrency.
- [ ] Frequent checkpoints.
- [ ] 24/7 incident coverage.
- [ ] Published proof/verification experience.
- [ ] Clear product language: attested confidential dealer, not fully trustless mental poker.
