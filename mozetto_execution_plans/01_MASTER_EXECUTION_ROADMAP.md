# 01 — Master Execution Roadmap

**Status:** Authoritative sequence  
**Entry gate:** Current V2 architecture builds locally and the existing Anvil E2E passes.  
**Exit gate:** Restricted Base Mainnet poker is operating under audited caps with public verification.

## Goal

Complete one trustworthy autonomous poker protocol before expanding product breadth. The critical path is not UI polish; it is custody correctness, deterministic game execution, verifiable randomness, AI reliability, proof-backed settlement, operational security, and public auditability.

## Rules for execution

1. A later phase may not reinterpret or bypass an earlier phase's invariants.
2. Every phase ends with machine-verifiable evidence.
3. Contracts, canonical hashes, engine behavior, AI profiles, and rake schedules are versioned and immutable for an active season.
4. Anvil proves logic; Sepolia proves integration; Mainnet proves neither. Mainnet is permitted only after both previous layers are complete.
5. No real-money session starts unless its entire buy-in is already locked.
6. No card is dealt before participant sealing and randomness binding.
7. No settlement is accepted unless it conserves funds and passes the configured verifier policy.

## Phase 0 — Repository stabilization

### Objective

Make the current repository reproducible before changing protocol semantics.

### Required work

- Pin Node, pnpm, Foundry, Rust, PostgreSQL, Redis, and Anvil versions.
- Add a single root command that boots all local services and reports readiness.
- Ensure migrations `001`–`016` apply from an empty database.
- Ensure the existing V2 ArenaAccount E2E runs from a clean Anvil chain.
- Add CI jobs for web, API, game server, contracts, database migrations, and existing poker tests.
- Remove production fallbacks to hardcoded rankings or mock balances.
- Generate a machine-readable current architecture manifest.

### Exit evidence

- Fresh clone to passing local E2E in one documented command sequence.
- CI green on a clean runner.
- A versioned `baseline-v2` Git tag.

## Phase 1 — Freeze protocol V3 specifications

### Objective

Define all canonical representations before new contract or proof code.

### Deliverables

- `MOZETTO_PROTOCOL_V3.md`
- `MOZETTO_POKER_EVENT_V1.md`
- `MOZETTO_RANDOMNESS_V2.md`
- `MOZETTO_SETTLEMENT_V3.md`
- `MOZETTO_CONTROLLER_V1.md`
- `MOZETTO_GAME_TEMPLATE_V2.md`
- Golden JSON/CBOR/ABI test vectors.

### Exit evidence

Independent TypeScript, Rust, and Solidity encoders produce identical hashes for all golden vectors.

## Phase 2 — Harden custody and permissions

### Objective

Make ArenaAccount and Vault the indisputable source of real-money truth.

### Work

- Finalize ArenaAccount ownership and withdrawal rules.
- Finalize GamePermission caps, expiry, revocation, target allowlist, and replay protection.
- Finalize SeatTicket batching for atomic table creation.
- Add strict settlement destination rules.
- Add protocol fee accrual and Safe sweep.
- Replace all client-trusted deposit crediting with chain-indexed events.
- Add solvency invariants and emergency controls.

### Exit evidence

Contract fuzzing cannot create, destroy, redirect, or over-lock USDC.

## Phase 3 — Introduce sealed session lifecycle

### Objective

Separate open matchmaking from immutable active play.

### States

```text
DRAFT → SEALED → RANDOMNESS_PENDING → READY → ACTIVE → SETTLING → SETTLED
                            ↘ ABORTED / EMERGENCY_EXIT
```

### Work

- Random ranked allocation.
- Participant/seat/controller root.
- No player changes after sealing.
- Continuous cash-table joins become a new epoch between hands.
- Pair caps and linked-account exclusions.

### Exit evidence

No participant, buy-in, profile, seat, or controller can change after the seal without creating a new epoch.

## Phase 4 — Deterministic poker core and Rust parity

### Objective

Make every legal action, event, pot, and balance reproducible.

### Work

- Freeze TypeScript engine behavior.
- Build pure Rust canonical core.
- Differential test TypeScript vs Rust vs PokerKit reference.
- Produce native, WASM, and replay-verifier builds.

### Exit evidence

Millions of generated states produce identical legal actions, events, winners, side pots, rake, and state hashes.

## Phase 5 — Verifiable randomness and confidential dealer

### Objective

Prevent Mozetto, players, and the public chain from individually choosing or predicting the deck.

### Work

- Private seed batches committed before VRF.
- Chainlink VRF integration.
- Deterministic deck derivation.
- Per-card commitments and deck roots.
- Deck-batch root anchoring.
- Nitro Enclave dealer and KMS attestation.
- Public proof verification for revealed cards.

### Exit evidence

Any changed card or rerolled seed fails verification; folded cards remain private.

## Phase 6 — Event roots, proof batches, and settlement V3

### Objective

Anchor the game history efficiently and settle only verified results.

### Work

- Canonical event hash chain.
- Hand roots, balance roots, and global proof batches.
- `ProofBatchRegistryV1`.
- `VerifierRouter` and `SettlementHubV3`.
- 2-of-3 Anvil; 3-of-5 Sepolia.
- Emergency exit from last accepted balance checkpoint.

### Exit evidence

A settlement with altered actions, cards, balances, rake, signatures, or roots is rejected.

## Phase 7 — Groq GPT-OSS 120B Season 1 agent

### Objective

Run one standardized AI engine for all ranked seats.

### Work

- Groq provider adapter for `openai/gpt-oss-120b`.
- Strict JSON Schema output.
- One master poker policy.
- Bounded strategy profiles.
- Private persistent Agent Brain.
- Provider SLOs, rate-limit controls, retries, and deterministic fallback.

### Exit evidence

AI-only tables complete without illegal actions or deadlocks under normal and degraded provider conditions.

## Phase 8 — Continuous cognition and 100 Energy

### Objective

Allow meaningful background thinking without unlimited compute.

### Work

- Event-driven cognitive scheduler.
- 100 Energy per hand.
- Final-action reserve.
- Structured memory and opponent models.
- Public decision cadence separated from provider latency.
- No raw chain-of-thought storage or broadcast.

### Exit evidence

Every inference debit is reproducible from the policy; no seat can exceed its budget; final actions meet the 15-second deadline.

## Phase 9 — Full Anvil protocol integration

### Objective

Prove the entire lifecycle locally with MockUSDC.

### Scenario

```text
mint → fund ArenaAccounts → grant permission → random match → lock → seal
→ VRF mock → committed decks → 100+ AI hands → proof batches
→ replay → quorum settlement → rake sweep → owner withdrawal
```

### Exit evidence

A scripted test runs repeatedly from a clean chain and verifies all balances and roots.

## Phase 10 — Operations, admin, and public verification

### Objective

Make the protocol operable without creating a super-admin attack path.

### Work

- Safe/timelock governance.
- Role-separated relayer, VRF, attestors, pauser, and treasury.
- Admin operational cockpit.
- Automatic pause on reconciliation failure.
- Public Verify Game page.
- Open-source verifier and watchtower prototype.

### Exit evidence

An operator can diagnose faults but cannot edit player balances or rewrite results.

## Phase 11 — Base Sepolia deployment

### Objective

Validate real wallets, RPCs, confirmations, VRF, relayers, indexer recovery, and hosted infrastructure.

### Work

- Deploy the exact V3 stack.
- Verify contracts and publish manifest.
- Run hosted API, game server, dealer, indexer, worker, and verifier.
- Open public test sessions using valueless assets.
- Publish test match proofs.

### Exit evidence

At least several weeks of stable public test operation, complete reindexing, and zero unexplained accounting differences.

## Phase 12 — Adversarial program and audits

### Objective

Attempt to break every trust boundary.

### Work

- Smart-contract audit.
- Poker-engine review.
- Dealer/randomness cryptography review.
- Wallet permission review.
- Infrastructure penetration test.
- Public testnet bounty.
- Chaos drills.

### Exit evidence

All critical/high findings closed and independently retested.

## Phase 13 — Restricted Base Mainnet

### Objective

Launch one narrow, controlled product.

### Initial limits

- One poker variant.
- One AI model.
- One ranked league family.
- Low maximum buy-in.
- Limited cohort.
- Strict concurrency and withdrawal controls.
- 24/7 monitoring.

### Expansion gate

Raise limits only after defined volume, uptime, dispute, settlement, and reconciliation thresholds are met.

## Parallel-safe work

After Phase 1 is frozen, the following may proceed in parallel:

- Rust engine core.
- Contract V3 implementation.
- Groq adapter and offline poker evaluation.
- Admin read-only dashboards.
- Open-source verifier CLI.

They converge only after their shared canonical specifications pass golden vectors.

## Work explicitly deferred

- Open multi-model league.
- PLO and Short Deck production.
- Tournaments.
- Blackjack and house vault.
- Marketplace.
- 3D avatar production system.
- Threshold/MPC mental poker.
- ZK settlement proof.

Those are sequenced in Plan 15.
