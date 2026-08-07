# 14 — Anvil, Base Sepolia, Mainnet, Testing, and Audit Plan

**Entry gate:** Individual workstreams have unit tests.  
**Exit gate:** Restricted mainnet release has passed all defined technical and operational gates.

## Environment purpose

### Anvil

Fast private chain for deterministic development, fuzzing, resets, unlimited mUSDC, and automated E2E.

### Base Sepolia

Public staging network for wallet behavior, RPC latency, relayers, real contract events, VRF, indexing, hosted services, and public verification.

### Base Mainnet

Real value. It is not a testing environment.

## Local Anvil stack

One command should start:

```text
Anvil
MockUSDC
all protocol contracts
Postgres/Supabase dev target
Redis
API
matchmaker
game gateway/orchestrator
Groq mock or controlled real adapter
dealer
replay verifier
chain indexer
settlement worker
web/admin
```

Use a deterministic default deployment, with optional randomized chaos mode.

## MockUSDC requirements

- six decimals;
- normal ERC-20 approve/transferFrom;
- mint/faucet only in local/staging mock environments;
- mainnet guard;
- no Vault bypass.

## CI layers

### Per commit

- typecheck/lint/build;
- unit tests;
- protocol vectors;
- Foundry unit/fuzz subset;
- Rust/TS deterministic fixtures;
- database migrations from empty;
- API schema tests.

### Nightly

- large Foundry invariant runs;
- millions of differential poker states;
- full Anvil E2E repeated runs;
- indexer rebuild;
- provider integration canary;
- load tests;
- mutation tests for proofs.

### Release candidate

- full chaos suite;
- signed reproducible artifacts;
- contract bytecode comparison;
- migration rehearsal;
- key/role review;
- rollback/recovery drill.

## Full Anvil E2E scenario

1. Deploy contracts.
2. Mint mUSDC to multiple owners.
3. Create/deploy ArenaAccounts.
4. Fund accounts.
5. Grant GamePermissions.
6. Enter ranked intents.
7. Randomly allocate HU and six-max sessions.
8. Atomically lock buy-ins.
9. Seal participants.
10. Commit dealer secret batch.
11. Fulfill mock VRF.
12. Commit deck batch.
13. Run AI-only hands with continuous cognition.
14. Anchor proof batches.
15. Simulate joins/leaves at legal epoch boundaries.
16. Replay and attest.
17. Settle.
18. Sweep rake.
19. Withdraw owner funds.
20. Reconcile all balances.
21. Run public verifier.

Repeat with random seeds and failure injection.

## Chaos matrix

Kill/delay/corrupt:

- game actor;
- WebSocket gateway;
- Redis;
- Postgres connection;
- primary RPC;
- fallback RPC;
- indexer;
- proof publisher;
- dealer parent process;
- dealer enclave communication;
- Groq request;
- attestor;
- settlement submitter;
- relayer transaction;
- VRF fulfillment.

Protocol response must be safe, deterministic, and documented.

## Security mutation tests

- replay SeatTicket;
- over-cap GamePermission;
- substitute ArenaAccount;
- change participant root;
- request second VRF;
- replace secret root;
- change one card;
- duplicate a card;
- reorder action;
- modify bet amount;
- forge event sequence;
- excessive rake;
- payout attacker address;
- duplicate settlement;
- fake signer;
- duplicate signer counted twice;
- stale deadline;
- emergency-exit replay.

## Sepolia deployment gate

Before deployment:

- all V3 contracts pass audit-oriented internal review;
- deployment script produces manifest automatically;
- roles use distinct staging keys;
- VRF subscription/config funded;
- hosted dealer/replay/indexer/worker ready;
- staging Supabase migrations complete;
- public environment labelled testnet.

## Sepolia program

### Stage A — team-only

- controlled wallets;
- full custody and settlement;
- no external users;
- complete reindex tests.

### Stage B — invited testers

- mUSDC/test USDC;
- public Verify Game;
- fault reporting;
- bounded concurrency.

### Stage C — adversarial public testnet

- public test rewards;
- open verifier/watchtower;
- intentionally documented attack surface;
- no real-value promises.

Run for weeks, not hours.

## Audit streams

Commission separate reviews for:

1. ArenaAccount/GamePermission/Vault/Settlement contracts.
2. Randomness and confidential dealer.
3. Poker engine and event/replay semantics.
4. Wallet/auth/session-key architecture.
5. Backend/cloud/KMS and admin security.

A single general audit is not sufficient for all layers.

## Mainnet readiness gate

All must be true:

- critical/high findings closed;
- bytecode matches audited commit;
- Safe/timelock live;
- key separation verified;
- independent attestors operational;
- production RPC redundancy;
- production Groq capacity agreement/limits understood;
- public verification complete;
- emergency exit tested;
- reconciliation automatic;
- incident drills complete;
- legal/compliance launch decision complete;
- responsible-play and account-security controls ready;
- bug bounty active.

## Restricted mainnet launch

Start with:

- one NLHE template;
- one standardized Groq model policy;
- low buy-in cap;
- limited users;
- one active region if necessary;
- strict max concurrent sessions;
- frequent checkpoints;
- enhanced manual monitoring;
- no house games;
- no Open AI league.

## Expansion metrics

Raise caps only if rolling window meets thresholds for:

- zero solvency discrepancies;
- settlement success rate;
- p99 settlement age;
- game-state divergence count = zero;
- dealer attestation success;
- AI fallback rate;
- uptime;
- dispute rate;
- security incident severity;
- watchtower verification rate.

Define numeric thresholds before mainnet rather than after observing weak results.
