# 16 — Agent Work Packets

This document converts the architecture into assignable units. Each work packet should be a separate branch/PR unless otherwise stated. Agents must not silently change a frozen protocol spec.

## Assignment rules

Every agent receives:

- exact work-packet ID;
- prerequisite commit/tag;
- allowed directories;
- forbidden scope;
- required tests;
- output artifacts;
- acceptance command.

Every PR must include:

- design summary;
- changed invariants;
- tests run;
- migration/rollback notes;
- security considerations;
- links to spec clauses.

## Wave 0 — Baseline

### WP-000 Reproducible local bootstrap

**Owns:** root scripts, environment docs, Docker/dev tooling.  
**Depends on:** none.

Deliver:

- one clean bootstrap command;
- readiness report;
- pinned tool versions;
- clean database/Anvil reset;
- CI baseline.

Accept when a fresh runner completes existing V2 E2E.

### WP-001 Current architecture manifest

Deliver a machine-readable map of contracts, services, ports, migrations, env names, and dependency versions. No behavior change.

## Wave 1 — Specifications

### WP-010 Protocol V3 spec

Own `/specs/MOZETTO_PROTOCOL_V3.md` and shared primitive definitions.

### WP-011 Poker event spec

Own canonical event encodings and golden vectors.

### WP-012 Randomness spec

Own secret/VRF/hand-seed/shuffle/card-root definitions.

### WP-013 Settlement/proof spec

Own balance leaves, roots, settlement payload, proof batches.

### WP-014 Controller/Energy spec

Own observation, action, profile, AgentState, Energy rules.

### WP-015 Cross-language protocol vectors

Implement TS/Rust/Solidity conformance tests after WP-010–014 freeze.

**Wave gate:** all vectors identical.

## Wave 2 — Custody and session contracts

### WP-020 ArenaAccount/GamePermission review

Audit current V2 implementation against Plan 3. Add missing caps, revocation, target restrictions, and tests without unnecessary redesign.

### WP-021 SeatTicket V3 and atomic funding

Implement canonical SeatTicket and batched atomic session funding.

### WP-022 GameRegistryV2

Implement immutable template registry and timelocked lifecycle.

### WP-023 Session lifecycle contract state

Implement DRAFT/SEALED/RANDOMNESS/READY/ACTIVE/SETTLING/SETTLED transitions.

### WP-024 ProtocolFeeVault and settlement destination constraints

Implement fee-only sweep and immutable player payout targets.

### WP-025 Contract invariants

Independent agent writes fuzz/invariant suite, not the contract author alone.

**Wave gate:** no invariant failure at agreed run count.

## Wave 3 — Poker core

### WP-030 Freeze TS engine behavior

Produce complete edge-case fixtures and state hashes.

### WP-031 Rust HU core

Implement pure HU NLHE.

### WP-032 Rust six-max core

Implement six-max after HU parity.

### WP-033 Hand evaluator

Independent evaluator/test vector package.

### WP-034 Differential oracle harness

TS vs Rust vs PokerKit generators/comparison.

### WP-035 WASM verifier

Build browser/CLI replay verifier after parity.

**Wave gate:** zero unexplained differential mismatches.

## Wave 4 — Matchmaking/session integration

### WP-040 Ranked random matchmaker

No public table selection; implement constraints and audit trace.

### WP-041 Session seal coordinator

Build participant roots and atomic funding trigger.

### WP-042 Epoch join/leave rotation

Implement queued joins/leaves between hands.

### WP-043 Anti-pairing and identity hooks

Pair caps, self-match block, linked-account interface.

**Wave gate:** participant mutation after seal impossible.

## Wave 5 — Randomness/dealer

### WP-050 RandomnessBeaconV2 contract

Secret-root/VRF binding, no reroll, deck-batch registration.

### WP-051 Dealer deterministic deck library

Implement hand seed, shuffle, card leaves, roots, proofs.

### WP-052 Mock VRF Anvil integration

Deterministic local test path.

### WP-053 Chainlink VRF adapter

Sepolia-ready implementation and request tracking.

### WP-054 Nitro Enclave dealer

Build enclave image, KMS attestation, private card delivery.

### WP-055 Randomness verifier CLI

Independent verification tool.

**Wave gate:** mutation tests fail and public card proofs pass.

## Wave 6 — Proofs and settlement

### WP-060 Canonical event store/hash chain

Persist encoded events and state hashes.

### WP-061 Hand/balance root builder

Build roots and proof generation.

### WP-062 ProofBatchRegistryV1

Base anchoring contract and publisher.

### WP-063 VerifierRouter/SettlementHubV3

Signature quorum now, pluggable proof policy later.

### WP-064 Replay verifier service

Independent Rust replay and settlement proposal validation.

### WP-065 Attestor services

Separate game/dealer/replay signatures and key management.

### WP-066 Emergency exit

Checkpoint claim contract path and tests.

**Wave gate:** all altered settlement/transcript cases rejected.

## Wave 7 — AI

### WP-070 Groq provider adapter

`openai/gpt-oss-120b`, strict schema, health and rate-limit handling.

### WP-071 Master policy and profile system

One policy, four presets, bounded sliders, canonical hashes.

### WP-072 AgentState store

Typed private state, bounded memory, reconstruction.

### WP-073 Continuous cognition scheduler

Event-driven background updates and priority queue.

### WP-074 Energy ledger

100 per hand, reserve, costs, auditing.

### WP-075 Public cadence controller

Separate provider latency from visible action timing.

### WP-076 Deterministic fallback

Auditable legal action controller.

### WP-077 Poker evaluation harness

Profile separation, latency, reliability, cost, bb/100.

**Wave gate:** AI-only sessions complete under load and provider faults.

## Wave 8 — Backend and chain integration

### WP-080 Table actor lease/recovery

Single writer, restart replay, split-brain prevention.

### WP-081 Persist-before-broadcast outbox

Transactional event/outbox pipeline.

### WP-082 Chain indexer V3

All contract events, reorgs, rebuild, lag metrics.

### WP-083 Reconciliation worker

Vault/contract/mirror consistency and auto-pause.

### WP-084 Settlement worker V3

Proposal, signatures, submit, confirmation, rating update.

### WP-085 Proof-batch publisher

Global batching and Base submission.

### WP-086 Hosted deployment recipes

API/game/dealer/verifier/indexer/worker, not only Vercel.

**Wave gate:** component restart tests produce no divergent state.

## Wave 9 — Product integrity surfaces

### WP-090 Public Verify Game page

Resolve hashes, show VRF/proofs/settlement and run WASM verifier.

### WP-091 Admin chain/solvency dashboard

Read-only first.

### WP-092 Admin session/randomness/AI dashboard

Operational health and investigation.

### WP-093 Safe/timelock proposal integration

No private key in browser.

### WP-094 Audit log and RBAC

Hardware MFA-ready separate admin deployment.

### WP-095 Watchtower prototype

Independent consumer of public data and proof verification.

## Wave 10 — Testing and release

### WP-100 Full Anvil E2E

One script covers complete protocol lifecycle.

### WP-101 Chaos suite

Kill/corrupt every service and verify safe behavior.

### WP-102 Sepolia deployment/manifest

Deploy, verify, publish exact artifacts.

### WP-103 Public testnet program

Invited then adversarial.

### WP-104 Audit remediation

Track findings to independently verified closure.

### WP-105 Restricted mainnet deployment

Only after final gate approval.

## Wave 11 — Production Integration (before Sepolia Stage A)

### WP-106 True full Anvil match lifecycle

Zero-GAP golden path: API/browser → Find Match → SeatTicket V3 → `sealAndFundSession` → real game → settle → withdraw. Anvil VRF + mUSDC only allowed mocks.

### WP-107 Live Groq AI table integration

Game-server runs Groq seats with continuous cognition, Energy, cadence for complete sessions; scale to 100→10k hands.

### WP-108 Real canonical roots

Gameplay produces real eventRoot/handRoot/balanceRoot; no stub settlement roots.

### WP-109 Poker release hardening

Uncalled bets, deep 6-max, sit-out/timeout; PokerKit mandatory oracle; large generated differential set; promote Rust binary hash into GameTemplate.

### WP-110 Hosted DB + WS cutover

Apply migrations 024–029; per-service GRANTs; AgentState/Energy DB persistence; WS v2.

### WP-111 Economics instrumentation

Actual Groq/chain/VRF/relayer/cloud COGS + rake contribution; freeze Season 1 rake only after empirical data.

### WP-112 Hosted proof pipeline

Continuous CheckpointSource → proof publisher → SQL inclusion proofs → Verify page.

### WP-113 Live chaos completeness

Multi-container Redis/RPC/VRF/dealer/worker/settlement failure drills (`CHAOS_LIVE=1`).

## Wave 12 — Consumer Product UX (Plan 20A)

### WP-120 Product IA / design system

Mass-market visual language, navigation, state system — not crypto dashboard.

### WP-121 Home

Play Now first; bankroll, AI ready, leagues, live matches, rating.

### WP-122 Play / Find Match

Game → league → profile → tune → Find Match.

### WP-123 Strategy setup

Shark/Fox/Professor/Machine + bounded trait controls; lock `profileConfigHash` at queue.

### WP-124 Wallet / onboarding

ArenaAccount, seamless play grant, test funds, caps — clear custody story.

### WP-125 Live table 2D

Premium animated autonomous poker; real cognition states; no CoT leak.

### WP-126 AI cognition presentation

Energy + OBSERVING/ANALYSING/… without private reasoning.

### WP-127 Result / replay

Result, rating delta, hand timeline, rematch.

### WP-128 Verify UX

In-session trust badge → deep Verify Game page.

### WP-129 Watch / spectator

Delayed ranked viewing and featured matches.

### WP-130 Rankings / profile

User-owned rating, aggression, record, bankroll results.

### WP-131 Mobile / performance

True mobile play/watch flow.

### WP-132 3D event adapter

Canonical events → avatar animation state; no art dependency; Plan 20B later.

## Parallelization map

After specs freeze:

- contract work and Rust engine may proceed in parallel;
- Groq offline evaluation may proceed in parallel;
- admin read-only UI may proceed using mock data;
- dealer and proof tooling depend on randomness/event specs;
- full integration waits for custody, engine, dealer, and AI gates.

## Agent completion template

Every agent must respond with:

```text
Work packet:
Commit/branch:
Files changed:
Spec clauses implemented:
Tests added:
Commands run:
Acceptance evidence:
Known limitations:
Security notes:
Follow-up dependencies:
```
