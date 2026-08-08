# Mozetto Control — Agent Work Packets

Each packet must have acceptance evidence before it is marked DONE.

---

## Wave C0 — Baseline

### MC-000 — Ship current baseline

**Depends:** none

**Deliver:** migrations applied, current work committed/pushed, baseline SHA recorded.

### MC-001 — Control architecture manifest

**Depends:** MC-000

Map existing admin routes, APIs, DB tables, roles and ops controls. No behavior change.

---

## Wave C1 — Authentication

### MC-010 — Admin SIWE nonce service

- dedicated nonce table/store;
- expiry/replay protection;
- domain/URI config.

### MC-011 — Admin SIWE verify/session

- signature verify;
- allowlist;
- admin_principals;
- session issuance.

### MC-012 — Admin session revoke/logout

- revoke current/all;
- audit events.

### MC-013 — Role/capability engine

- explicit capabilities;
- endpoint guards.

### MC-014 — Break-glass token compatibility

Keep CLI token path, remove token from primary UI.

### MC-015 — Auth test suite

Replay, wrong-wallet, expired nonce, revoked principal, privilege escalation.

**Wave gate:** allowed wallet only + no browser admin token.

---

## Wave C2 — Shell

### MC-020 — ControlShell

Rail, header, identity footer, environment state.

### MC-021 — Shared UI primitives

Metric card, health badge, table, range, page header, danger action.

### MC-022 — Existing page reshell

Solvency, sessions, randomness, AI, treasury, governance, audit.

### MC-023 — Global search

Resolve wallet/profile/session/table/hand/tx/proof.

### MC-024 — Staleness/source UX

Unified `lastUpdated`, source and stale presentation.

---

## Wave C3 — Command Center

### MC-030 — Admin overview API

Bounded aggregation, component health.

### MC-031 — Command Center UI

Hero metrics, incidents, service graph, city activity.

### MC-032 — Service health registry

Versions/commits/heartbeats.

### MC-033 — Alert thresholds

Solvency, settlement, VRF, AI, indexer, DB/Redis.

---

## Wave C4 — Economics

### MC-040 — Canonical admin economics schema

Freeze definitions for rake/COGS/contribution.

### MC-041 — City economics API

Revenue/COGS/margin per city.

### MC-042 — Economics UI

Trends, ranges, city table.

### MC-043 — Player stats read model

View/query plan.

### MC-044 — Player list API/UI

Search/filter/pagination.

### MC-045 — Player detail P&L

Money, sessions, rake, rating.

### MC-046 — Export audit

CSV with generated metadata + audit.

---

## Wave C5 — Player risk/support

### MC-050 — Integrity aggregation

Pair caps, linked accounts, rat-hole, review status.

### MC-051 — Player restriction controls

New-match restriction only; reason + audit.

### MC-052 — Replay request workflow

Request verifier; attach result.

### MC-053 — Responsible-play state read surface

Respect user safety restrictions.

### MC-054 — Player admin timeline

Unified activity/funding/session/admin timeline.

---

## Wave C6 — Live game operations

### MC-060 — Sessions v2 list

Full city/hand/AI/settlement fields.

### MC-061 — Session detail v2

Overview, events, money, AI, randomness, proofs.

### MC-062 — Pause-after-hand operation

End-to-end consumption in game server + audit.

### MC-063 — Drain table/city

No new seats/tables; safe close semantics.

### MC-064 — Resume safety gate

Validate lease/replay/incidents before resume.

### MC-065 — Matchmaking cockpit

Queue/wait/utilization/rejection reasons.

---

## Wave C7 — AI operations

### MC-070 — AI economics/latency API

Provider/model/profile/city breakdown.

### MC-071 — AI health page v2

SLOs, fallback, Energy, COGS.

### MC-072 — Policy/version inventory

Hashes + active deployment.

### MC-073 — AgentState persistence health

DB/memory/reconstruction diagnostics.

### MC-074 — AI activity feed diagnostics

Sequence gaps, persistence/replay health.

### MC-075 — Provider disable safe control

New calls only + fallback semantics.

### MC-076 — AI policy rollback workflow

Safe boundary + deployment audit.

---

## Wave C8 — Protocol operations

### MC-080 — Solvency v2

Source/block/age + independent verification.

### MC-081 — Chain manifest/code hash

Expected vs live contracts.

### MC-082 — Randomness lifecycle UI

Commit/VRF/deck batch/attestation.

### MC-083 — Proof continuity UI

Proof batches + watchtower.

### MC-084 — Settlement queue UI

Quorum/submission/confirmations/retry.

### MC-085 — Reconciliation/watchtower triggers

Safe request-only controls.

---

## Wave C9 — Governance

### MC-090 — Capability tier UI

Read/soft/runtime/governed/emergency.

### MC-091 — Governance preview

Before/after + simulation.

### MC-092 — Proposal archive

Persist metadata and hashes.

### MC-093 — Safe/timelock export flow v2

No private keys.

### MC-094 — Post-execution verification

Ingest tx and compare post-state.

### MC-095 — Principal management

Wallet roles/revoke + step-up.

---

## Wave C10 — Incidents/security

### MC-100 — Incident schema/API

### MC-101 — Incidents board

### MC-102 — Auto incident from solvency/watchtower

### MC-103 — Runbook links and timeline

### MC-104 — SIEM/audit export

### MC-105 — Secret/config metadata page

No secret values.

---

## Wave C11 — Release

### MC-110 — Full browser E2E

### MC-111 — Admin security suite

### MC-112 — Control chaos visibility

### MC-113 — Sepolia internal deploy

### MC-114 — Mainnet read-only deploy

### MC-115 — Limited mutation enablement

---

## Definition of packet DONE

Every packet requires:

1. code merged;
2. tests/typecheck green;
3. docs updated;
4. audit/security implications reviewed;
5. screenshots or API evidence where UI/API relevant;
6. no untracked schema changes;
7. progress tracker updated.
