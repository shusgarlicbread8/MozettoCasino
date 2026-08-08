# Mozetto Control — Progress Tracker

**Authority:** [`mozetto_control_superadmin_plans/`](../mozetto_control_superadmin_plans/) (`00`–`15`, `MANIFEST.md`).  
**Doctrine:** Control is an ops cockpit, not a chain super-key. No silent balance edits. Current hands immutable from ops UI. Every mutation attributable.  
**Privacy:** Control never exposes raw model CoT / live hole cards. AI surfaces use structured public activity only.  
**Rule:** Packet = `DONE` only with acceptance evidence. Update this file every work turn.

**Status values:** `NOT_STARTED` · `IN_PROGRESS` · `BLOCKED` · `DONE` · `DEFERRED`

---

## Current focus

| Field | Value |
|---|---|
| **Active wave** | **C0 → C1** (baseline ship, then wallet auth) |
| **Active packets** | MC-000 `IN_PROGRESS` → MC-001 + MC-010…015 |
| **Baseline SHA** | _(pending MC-000 push)_ |
| **Superadmin allowlist** | Env `ADMIN_SUPERADMIN_ADDRESSES` only — never hardcode wallet in app code |
| **App** | Evolve `apps/admin` @ `:3001` into Mozetto Control |
| **Hard stops** | No Protocol/Treasury Safe keys in browser; no set-balance endpoints; no mid-hand card/stack/profile rewrite |

---

## Phase rollup

| Phase | Name | Status | Notes |
|---|---|---|---|
| 0 | Ship poker baseline | `IN_PROGRESS` | Migrations through `036`; commit/push next |
| 1 | Wallet-gated admin identity | `NOT_STARTED` | Plan `02`; wave C1 |
| 2 | Control shell & IA | `NOT_STARTED` | Plan `03`; wave C2 |
| 3 | Command Center | `NOT_STARTED` | Plan `04`; wave C3 |
| 4 | Economics / treasury / P&L | `NOT_STARTED` | Plan `05`; wave C4 |
| 5 | Players / risk / support | `NOT_STARTED` | Plan `06`; wave C5 |
| 6 | Table / session / MM ops | `NOT_STARTED` | Plan `07`; wave C6 |
| 7 | AI model & agent ops | `NOT_STARTED` | Plan `08`; wave C7 |
| 8 | Chain / solvency / randomness / proofs | `NOT_STARTED` | Plan `09`; wave C8 |
| 9 | Governance & mutation controls | `NOT_STARTED` | Plan `10`; wave C9 |
| 10 | Incidents / security / audit | `NOT_STARTED` | Plan `11`; wave C10 |
| 11 | Testing / deploy / release | `NOT_STARTED` | Plan `13`; wave C11 |

---

## Parallelization map

```text
MC-000 baseline → MC-001 manifest
                 ↓
              C1 Auth (serial — freeze contracts)
                 ↓
              C2 Shell
                 ↓
        ┌────────┼────────┬────────┐
        C3       C4       C6       C7
     Overview Economics Tables/MM   AI
        └────────┼────────┴────────┘
                 ↓
              C5 Players/Risk (needs C4 player APIs)
                 ↓
              C8 Protocol ops
                 ↓
              C9 Governance
                 ↓
              C10 Incidents
                 ↓
              C11 Release (Sepolia → mainnet RO → limited mutate)
```

---

## Work packets

### Wave C0 — Baseline

| Packet | Status | Evidence / notes |
|---|---|---|
| MC-000 Ship current baseline | `IN_PROGRESS` | `pnpm db:migrate` applied `036_ai_activity_feed.sql`; commit+push pending |
| MC-001 Control architecture manifest | `NOT_STARTED` | Map existing admin routes/APIs/DB/roles → `docs/MOZETTO_CONTROL_ARCHITECTURE.md` |

### Wave C1 — Authentication

| Packet | Status | Evidence / notes |
|---|---|---|
| MC-010 Admin SIWE nonce service | `NOT_STARTED` | |
| MC-011 Admin SIWE verify/session | `NOT_STARTED` | |
| MC-012 Admin session revoke/logout | `NOT_STARTED` | |
| MC-013 Role/capability engine | `NOT_STARTED` | |
| MC-014 Break-glass token compatibility | `NOT_STARTED` | |
| MC-015 Auth test suite | `NOT_STARTED` | |

### Wave C2 — Shell

| Packet | Status | Evidence / notes |
|---|---|---|
| MC-020 ControlShell | `NOT_STARTED` | |
| MC-021 Shared UI primitives | `NOT_STARTED` | |
| MC-022 Existing page reshell | `NOT_STARTED` | |
| MC-023 Global search | `NOT_STARTED` | |
| MC-024 Staleness/source UX | `NOT_STARTED` | |

### Wave C3 — Command Center

| Packet | Status | Evidence / notes |
|---|---|---|
| MC-030 Admin overview API | `NOT_STARTED` | |
| MC-031 Command Center UI | `NOT_STARTED` | |
| MC-032 Service health registry | `NOT_STARTED` | |
| MC-033 Alert thresholds | `NOT_STARTED` | |

### Wave C4 — Economics

| Packet | Status | Evidence / notes |
|---|---|---|
| MC-040 Canonical admin economics schema | `NOT_STARTED` | |
| MC-041 City economics API | `NOT_STARTED` | |
| MC-042 Economics UI | `NOT_STARTED` | |
| MC-043 Player stats read model | `NOT_STARTED` | |
| MC-044 Player list API/UI | `NOT_STARTED` | |
| MC-045 Player detail P&L | `NOT_STARTED` | |
| MC-046 Export audit | `NOT_STARTED` | |

### Wave C5 — Player risk/support

| Packet | Status | Evidence / notes |
|---|---|---|
| MC-050 Integrity aggregation | `NOT_STARTED` | |
| MC-051 Player restriction controls | `NOT_STARTED` | |
| MC-052 Replay request workflow | `NOT_STARTED` | |
| MC-053 Responsible-play state | `NOT_STARTED` | |
| MC-054 Player admin timeline | `NOT_STARTED` | |

### Wave C6 — Live game operations

| Packet | Status | Evidence / notes |
|---|---|---|
| MC-060 Sessions v2 list | `NOT_STARTED` | |
| MC-061 Session detail v2 | `NOT_STARTED` | |
| MC-062 Pause-after-hand E2E | `NOT_STARTED` | |
| MC-063 Drain table/city | `NOT_STARTED` | |
| MC-064 Resume safety gate | `NOT_STARTED` | |
| MC-065 Matchmaking cockpit | `NOT_STARTED` | |

### Wave C7 — AI operations

| Packet | Status | Evidence / notes |
|---|---|---|
| MC-070 AI economics/latency API | `NOT_STARTED` | |
| MC-071 AI health page v2 | `NOT_STARTED` | |
| MC-072 Policy/version inventory | `NOT_STARTED` | |
| MC-073 AgentState persistence health | `NOT_STARTED` | |
| MC-074 AI activity feed diagnostics | `NOT_STARTED` | |
| MC-075 Provider disable safe control | `NOT_STARTED` | |
| MC-076 AI policy rollback workflow | `NOT_STARTED` | |

### Wave C8 — Protocol operations

| Packet | Status | Evidence / notes |
|---|---|---|
| MC-080 Solvency v2 | `NOT_STARTED` | |
| MC-081 Chain manifest/code hash | `NOT_STARTED` | |
| MC-082 Randomness lifecycle UI | `NOT_STARTED` | |
| MC-083 Proof continuity UI | `NOT_STARTED` | |
| MC-084 Settlement queue UI | `NOT_STARTED` | |
| MC-085 Reconciliation/watchtower triggers | `NOT_STARTED` | |

### Wave C9 — Governance

| Packet | Status | Evidence / notes |
|---|---|---|
| MC-090 Capability tier UI | `NOT_STARTED` | |
| MC-091 Governance preview | `NOT_STARTED` | |
| MC-092 Proposal archive | `NOT_STARTED` | |
| MC-093 Safe/timelock export v2 | `NOT_STARTED` | |
| MC-094 Post-execution verification | `NOT_STARTED` | |
| MC-095 Principal management | `NOT_STARTED` | |

### Wave C10 — Incidents / security

| Packet | Status | Evidence / notes |
|---|---|---|
| MC-100 Incident schema/API | `NOT_STARTED` | |
| MC-101 Incidents board | `NOT_STARTED` | |
| MC-102 Auto incident from solvency/watchtower | `NOT_STARTED` | |
| MC-103 Runbook links and timeline | `NOT_STARTED` | |
| MC-104 SIEM/audit export | `NOT_STARTED` | |
| MC-105 Secret/config metadata page | `NOT_STARTED` | |

### Wave C11 — Release

| Packet | Status | Evidence / notes |
|---|---|---|
| MC-110 Full browser E2E | `NOT_STARTED` | |
| MC-111 Admin security suite | `NOT_STARTED` | |
| MC-112 Control chaos visibility | `NOT_STARTED` | |
| MC-113 Sepolia internal deploy | `NOT_STARTED` | |
| MC-114 Mainnet read-only deploy | `NOT_STARTED` | |
| MC-115 Limited mutation enablement | `NOT_STARTED` | |

---

## Turn log

| When | Wave | Notes |
|---|---|---|
| 2026-08-08 | C0 | Created tracker; applied migration `036` via `pnpm db:migrate`; preparing baseline commit |

---

## Authority tiers (reminder)

| Tier | Name | Execution |
|---|---|---|
| 0 | Read | immediate |
| 1 | Soft ops | immediate + audit |
| 2 | Runtime control | step-up + audit |
| 3 | Governed chain | proposal → Safe/timelock only |
| 4 | Emergency | dedicated guardian path + incident |
