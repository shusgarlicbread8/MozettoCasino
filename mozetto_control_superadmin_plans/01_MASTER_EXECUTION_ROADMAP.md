# Mozetto Control — Master Execution Roadmap

This is the authoritative implementation order for the Control project.

---

## Phase 0 — Ship the current poker baseline

**Objective:** Begin Control work from a clean, reproducible commit.

### Deliverables

- Apply migrations through current head.
- Verify local + hosted migration status.
- Run existing typecheck/test/preplay gates.
- Commit outstanding table UX, bust/top-up, AI activity/intelligence and migration work.
- Push to `origin/main`.
- Create `docs/MOZETTO_CONTROL_PROGRESS.md` with baseline SHA.

### Exit gate

```text
working tree clean
migrations current
CI green
baseline SHA recorded
```

---

## Phase 1 — Wallet-gated admin identity

**Objective:** Replace token-as-primary-login with wallet SIWE, while keeping tokens as break-glass automation credentials.

### Build

- `ADMIN_SUPERADMIN_ADDRESSES` allowlist.
- DB `admin_principals` wallet subjects.
- Dedicated admin nonce and session flow.
- `mozetto_admin_session` HttpOnly cookie.
- `/v1/admin/auth/nonce`.
- `/v1/admin/auth/verify`.
- `/v1/admin/auth/logout`.
- `/v1/admin/me`.
- Role/capability claims.
- Session revocation.
- Audit of login, logout, denied access, mutation attempts.

### Exit gate

- wrong wallet cannot render shell or hit admin APIs;
- allowed wallet can authenticate;
- browser never receives admin token secrets;
- break-glass token still works for CLI;
- wallet actor appears in `admin_actions`.

---

## Phase 2 — Control Shell and navigation

**Objective:** Turn the current admin app into one coherent cockpit.

### Build

- `ControlShell`.
- Sectioned rail.
- Global status header.
- Environment chip (`LOCAL`, `SEPOLIA`, `MAINNET`).
- Wallet/role footer.
- Staleness badge.
- Global entity search.
- Command palette.
- Shared cards/tables/range filters/status badges.
- Route permission guards.

### Existing pages to reshell

- solvency;
- sessions;
- randomness;
- AI;
- treasury;
- governance;
- audit;
- verify.

### Exit gate

Every existing admin capability is reachable from one shell with no duplicated auth logic.

---

## Phase 3 — Command Center and telemetry

**Objective:** Make `/` answer "is Mozetto healthy?" within five seconds.

### Build aggregated endpoint

`GET /v1/admin/overview?range=1d|7d|30d`

It should aggregate, but not invent authority.

### Required sections

- protocol solvency;
- active tables;
- users seated;
- hands/min and hands/hour;
- gross rake;
- AI COGS;
- chain/VRF/proof state;
- settlement queue depth;
- indexer lag;
- worker health;
- open incidents;
- fallback rate;
- timeout rate;
- degraded cities/providers.

### Exit gate

The Command Center can enter explicit `DEGRADED` or `UNAVAILABLE` states instead of showing stale green metrics.

---

## Phase 4 — Economics, treasury, P&L

**Objective:** Give the operator a complete economic picture without granting spending authority.

### Build

- Economics page.
- Per-city revenue/margin.
- AI provider COGS.
- chain gas / VRF / proof costs.
- infra cost input/estimates.
- contribution margin.
- rake trend.
- settlement fee trend.
- treasury read view.
- fee vault accrual.
- player P&L list and detail.
- session-level P&L.
- CSV exports with audit record.

### Exit gate

Totals reconcile across revenue, fee vault, player payouts and session accounting for the selected time window.

---

## Phase 5 — Players, integrity and support

**Objective:** Make a wallet/profile/session inspectable without creating covert operator powers.

### Build

- Player search.
- Profile + wallet bindings.
- ArenaAccount state.
- available / at-table / settling balances.
- deposits / withdrawals / session P&L.
- rating / aggression / profile usage.
- pair history.
- rat-hole/re-entry history.
- linked-account risk edges.
- collusion/risk signals.
- responsible-play status.
- support notes / admin case linking.

### Safe controls

- block **new** ranked matchmaking;
- mark under review;
- request replay;
- require manual integrity review;
- revoke admin-created promotional access if such a system exists;
- never edit balances or live hands.

---

## Phase 6 — Table/session/matchmaking operations

**Objective:** Operate live poker safely.

### Build

- live table list;
- table detail;
- current hand state;
- seat states;
- last canonical event;
- actor lease/fencing status;
- outbox status;
- settlement lifecycle;
- randomness/proof linkage;
- AI decision SLO per seat;
- queued leave/sit-out/top-up changes.

### Controls

- pause after current hand;
- resume if safe;
- mark under review;
- request replay verifier;
- drain table after hand;
- disable new seats;
- disable new tables for city;
- pause ranked intents;
- never force arbitrary stack/card/action changes.

---

## Phase 7 — AI operations

**Objective:** Operate autonomous seats as a production inference system.

### Build

- provider health;
- model policy hash;
- master policy version;
- profile distribution;
- latency p50/p95/p99;
- timeout/fallback rates;
- invalid-response rate;
- Energy spend by street;
- COGS per hand/session/city;
- AgentState persistence health;
- AI activity stream health;
- prompt/policy deployment history;
- live evaluation reports.

### Controls

- disable provider for new decisions;
- fail closed to deterministic fallback;
- stop new AI sessions;
- pin approved policy version;
- roll back policy deployment;
- no mid-hand personality/profile rewrite.

---

## Phase 8 — Chain, randomness, proof and settlement ops

**Objective:** Make cryptographic/protocol health operable from one place.

### Build

- chain manifest view;
- contract code hash/addresses;
- RPC health;
- vault liabilities;
- protocol fee vault;
- randomness request lifecycle;
- deck batch commitments;
- proof batch continuity;
- replay verifier status;
- attestor quorum health;
- settlement queue;
- emergency exit eligibility;
- watchtower reports;
- indexer lag/reorgs.

### Controls

Operational controls may pause new exposure. Contract mutations remain proposal-only.

---

## Phase 9 — Governance and mutation safety

**Objective:** Turn every dangerous change into a reviewable change request.

### Build

- capability matrix;
- change preview;
- before/after diff;
- impact analysis;
- simulation;
- proposal archive;
- Safe JSON export;
- timelock schedule status;
- execution receipt ingestion;
- post-change verification.

### Exit gate

There is no critical chain mutation button that executes directly from a browser-admin private key.

---

## Phase 10 — Incidents and reliability

**Objective:** Make failures managed events, not ad-hoc Slack messages.

### Build

- incidents board;
- severity/state;
- automatic incident creation from reconciliation/watchtower thresholds;
- affected entities;
- owner;
- timeline;
- runbook links;
- linked admin actions;
- postmortem export.

---

## Phase 11 — Deployment and release hardening

### Required

- admin app separately deployable;
- restricted ingress;
- strict CORS;
- production cookie settings;
- rate limits;
- CSRF protection on cookie-backed mutations;
- session revocation;
- SIWE replay tests;
- wallet allowlist tests;
- privilege escalation tests;
- audit immutability tests;
- chaos tests;
- staging manual runbook.

### Exit gate

Control can be deployed to staging without exposing secrets or granting browser chain custody.

---

## Parallelization map

After Phase 1 auth contracts are frozen, three tracks can proceed in parallel:

```text
TRACK A — UI/SHELL
ControlShell → Command Center → page reshell

TRACK B — READ APIS
Overview → Economics → Players → Chain/AI telemetry

TRACK C — CONTROL SAFETY
Capabilities → audited mutations → incidents → governance proposals
```

Do not parallelize conflicting auth/session implementations.
