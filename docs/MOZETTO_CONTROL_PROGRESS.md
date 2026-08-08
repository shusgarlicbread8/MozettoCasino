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
| **Active wave** | **C8 Protocol** (C5 DONE; C6 drain/resume; MC-046 export) |
| **Active packets** | MC-080+; MC-046 export; C6 drain/resume |
| **Baseline SHA** | `6b7ab332de11e24ead3549eaea2c0b04dcf61df4` |
| **Superadmin allowlist** | Env `ADMIN_SUPERADMIN_ADDRESSES` only — never hardcode wallet in app code |
| **App** | Evolve `apps/admin` @ `:3001` into Mozetto Control |
| **Hard stops** | No Protocol/Treasury Safe keys in browser; no set-balance endpoints; no mid-hand card/stack/profile rewrite |

---

## Phase rollup

| Phase | Name | Status | Notes |
|---|---|---|---|
| 0 | Ship poker baseline | `DONE` | `6b7ab33`; migrate `036` applied; plans + tracker in repo |
| 1 | Wallet-gated admin identity | `DONE` | Wave C1 MC-010–015; migration `037`, SIWE routes, admin login |
| 2 | Control shell & IA | `DONE` | Shell, primitives, search, IA routes; existing pages inherit rail |
| 3 | Command Center | `DONE` | MC-030–033 overview API + hero UI + thresholds |
| 4 | Economics / treasury / P&L | `DONE` | MC-040–045; city econ + players; export MC-046 remaining |
| 5 | Players / risk / support | `DONE` | MC-050–054; migration `039`; `/risk` + player integrity UI |
| 6 | Table / session / MM ops | `IN_PROGRESS` | MC-060/061/065 DONE; drain/resume remaining |
| 7 | AI model & agent ops | `DONE` | MC-070–074 DONE; mutate controls MC-075/076 remaining |
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
| MC-000 Ship current baseline | `DONE` | `pnpm db:migrate` → `036`; commit `6b7ab33` pushed to `origin/main` |
| MC-001 Control architecture manifest | `DONE` | Evidence: [`docs/MOZETTO_CONTROL_ARCHITECTURE.md`](MOZETTO_CONTROL_ARCHITECTURE.md) — routes, `/v1/admin/*`, DB, auth, ops/governance, IA gaps, evolve-file list |

### Wave C1 — Authentication

| Packet | Status | Evidence / notes |
|---|---|---|
| MC-010 Admin SIWE nonce service | `DONE` | `GET /v1/admin/auth/nonce`; table `admin_siwe_nonces`; `services/api/src/admin-wallet-auth.ts` |
| MC-011 Admin SIWE verify/session | `DONE` | `POST /v1/admin/auth/verify`; `admin_sessions` + `mozetto_admin_session` cookie; `ADMIN_SESSION_SECRET` |
| MC-012 Admin session revoke/logout | `DONE` | `POST /v1/admin/auth/logout`; revokes `admin_sessions`; clears cookie |
| MC-013 Role/capability engine | `DONE` | Control roles + `controlCapabilities`; extended `admin_principals` CHECK in `037` |
| MC-014 Break-glass token compatibility | `DONE` | `x-admin-token` / `admin_token` + `?breakglass=1` UI; token audit `admin.auth.token_used` |
| MC-015 Auth test suite | `DONE` | `services/api/src/admin-auth.test.ts`, `admin-wallet-auth.test.ts`; `pnpm --filter @mozetto/api test` |

### Wave C2 — Shell

| Packet | Status | Evidence / notes |
|---|---|---|
| MC-020 ControlShell | `DONE` | `apps/admin/src/components/control/ControlShell.tsx` — rail/header/footer; skips `/login` |
| MC-021 Shared UI primitives | `DONE` | Metric/Table/Health/Range/PageHeader/DangerAction under `components/control/` |
| MC-022 Existing page reshell | `DONE` | Layout ControlShell; sessions/AI/economics/command center use primitives |
| MC-023 Global search | `DONE` | `ControlGlobalSearch` in topbar — wallet/session/tx/incident heuristics → routes |
| MC-024 Staleness/source UX | `DONE` | Metric cards require source/lastUpdated/status; stale table banner; health badges |

### Wave C3 — Command Center

| Packet | Status | Evidence / notes |
|---|---|---|
| MC-030 Admin overview API | `DONE` | Deepened `GET /v1/admin/overview?range=1d\|7d\|30d` — `services/api/src/admin-overview.ts`; component health + bounded parallel fanout |
| MC-031 Command Center UI | `DONE` | `apps/admin/src/app/page.tsx` — CEO strip (solvency, play, economics, settlement, incidents, AI) + service topology |
| MC-032 Service health registry | `DONE` | `overview.services[]` — version from package.json + `/health` probe (api/game/agent/dealer/replay/indexer) |
| MC-033 Alert thresholds | `DONE` | `services/api/src/admin-thresholds.ts` — indexer lag/stale, settlement age/queue, VRF pending, AI fallback/p95; wired into component status |

### Wave C4 — Economics

| Packet | Status | Evidence / notes |
|---|---|---|
| MC-040 Canonical admin economics schema | `DONE` | `services/api/src/admin-economics-schema.ts` — USD micro fields + availability types |
| MC-041 City economics API | `DONE` | `GET /v1/admin/economics/cities`; `admin-economics-cities.ts` |
| MC-042 Economics UI | `DONE` | City table via `ControlTable` on `/economics`; metric cards retained |
| MC-043 Player stats read model | `DONE` | Migration `038_admin_player_stats_v1.sql` — view over profiles/ledger/sessions |
| MC-044 Player list API/UI | `DONE` | `GET /v1/admin/players`; `apps/admin/src/app/players/page.tsx` |
| MC-045 Player detail P&L | `DONE` | `GET /v1/admin/players/:id`; `apps/admin/src/app/players/[id]/page.tsx` |
| MC-046 Export audit | `NOT_STARTED` | |

### Wave C5 — Player risk/support

| Packet | Status | Evidence / notes |
|---|---|---|
| MC-050 Integrity aggregation | `DONE` | `GET /v1/admin/players/:id/integrity` + `GET /v1/admin/risk/overview`; `services/api/src/admin-players-risk.ts` |
| MC-051 Player restriction controls | `DONE` | Migration `039`, `POST /v1/admin/players/:id/restrictions`; `packages/database/src/admin-player-ops.ts` |
| MC-052 Replay request workflow | `DONE` | `POST /v1/admin/players/:id/request-replay` → session ops `request_replay` + player audit |
| MC-053 Responsible-play state | `DONE` | `GET /v1/admin/players/:id/responsible-play` — best-effort; UNAVAILABLE until dedicated tables |
| MC-054 Player admin timeline | `DONE` | `GET /v1/admin/players/:id/admin-history`; `/risk` + player detail integrity wired |

### Wave C6 — Live game operations

| Packet | Status | Evidence / notes |
|---|---|---|
| MC-060 Sessions v2 list | `DONE` | `GET /v1/admin/sessions` enriched fields + ControlTable list UI |
| MC-061 Session detail v2 | `DONE` | `GET /v1/admin/session/:id` sections + reshelled detail page |
| MC-062 Pause-after-hand E2E | `PARTIAL` | Ops POST audited; UI documents hand-boundary semantics; game-server consumption tracked separately |
| MC-063 Drain table/city | `NOT_STARTED` | |
| MC-064 Resume safety gate | `NOT_STARTED` | |
| MC-065 Matchmaking cockpit | `DONE` | `GET /v1/admin/matchmaking` + matchmaking page wired |

### Wave C7 — AI operations

| Packet | Status | Evidence / notes |
|---|---|---|
| MC-070 AI economics/latency API | `DONE` | `GET /v1/admin/ai/economics` — provider/model/profile/city breakdown + agent-runtime COGS merge (`services/api/src/admin-ai.ts`) |
| MC-071 AI health page v2 | `DONE` | `apps/admin/src/app/ai/page.tsx` — Control primitives, SLOs, fallback, Energy, COGS, UNAVAILABLE when missing |
| MC-072 Policy/version inventory | `DONE` | `GET /v1/admin/ai/deployments` — agent-runtime /health + profile/session hash inventory |
| MC-073 AgentState persistence health | `DONE` | `GET /v1/admin/ai/agent-state` — store backend, lag, checkpoint counts (no raw state_json) |
| MC-074 AI activity feed diagnostics | `DONE` | `GET /v1/admin/ai/activity-feed` — event counts, latest seq, sequence gap signals |
| MC-075 Provider disable safe control | `NOT_STARTED` | Stub note on AI Ops page — read-only pass; needs audited `ai.disable_provider` feature-flag path |
| MC-076 AI policy rollback workflow | `NOT_STARTED` | |

### Wave C8 — Protocol operations

| Packet | Status | Evidence / notes |
|---|---|---|
| MC-080 Solvency v2 | `DONE` | `/solvency` — source/block/age, watchtower signal, `ControlHealthBadge` |
| MC-081 Chain manifest/code hash | `DONE` | `/chain` — `GET /v1/admin/chain`, manifest vs env, live code hash |
| MC-082 Randomness lifecycle UI | `DONE` | `/randomness` — lifecycle stages COMMITTED→DECK_BATCH_REGISTERED |
| MC-083 Proof continuity UI | `DONE` | `/settlement` proofs section — `GET /v1/admin/proofs` |
| MC-084 Settlement queue UI | `DONE` | `/settlement` queue — `GET /v1/admin/settlements` |
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
| 2026-08-08 | C0 | Tracker created; `036` migrated; baseline `6b7ab33` pushed |
| 2026-08-08 | C1 | Launching MC-001 + C1 (MC-010–015) subagents in parallel |
| 2026-08-08 | C0/C1 | MC-001 DONE — architecture manifest at `docs/MOZETTO_CONTROL_ARCHITECTURE.md` |
| 2026-08-08 | C1 | MC-010–015 DONE — migration `037`, SIWE auth API, admin wallet login, tests |
| 2026-08-08 | C4 | MC-040–045 DONE — economics schema, city API, player view `038`, players UI |
| 2026-08-09 | C5 | MC-050–054 DONE — integrity API, player restrictions, replay, timeline, risk UI |

---

## Authority tiers (reminder)

| Tier | Name | Execution |
|---|---|---|
| 0 | Read | immediate |
| 1 | Soft ops | immediate + audit |
| 2 | Runtime control | step-up + audit |
| 3 | Governed chain | proposal → Safe/timelock only |
| 4 | Emergency | dedicated guardian path + incident |
