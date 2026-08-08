# Mozetto Control — Shell, Navigation and UX System

## 1. Design goal

Mozetto Control should feel like a serious operations terminal:

- dark Mozetto visual system;
- compact 232px rail;
- information-dense tables;
- monospace values;
- explicit health/status coloring;
- zero decorative metrics without provenance;
- fast drill-down from platform → city → table → session → hand → player.

Copy interaction patterns, not visual identity, from the AdeHQ admin shell reference.

---

## 2. Navigation

### CONTROL

- **Command Center** `/`

### BUSINESS

- **Economics** `/economics`
- **Players** `/players`
- **Cities & Stakes** `/cities`

### LIVE OPS

- **Tables & Sessions** `/sessions`
- **Matchmaking** `/matchmaking`
- **AI Operations** `/ai`
- **Incidents** `/incidents`

### PROTOCOL

- **Solvency** `/solvency`
- **Treasury** `/treasury`
- **Randomness** `/randomness`
- **Proofs & Settlement** `/settlement`
- **Chain** `/chain`

### SECURITY

- **Risk & Integrity** `/risk`
- **Governance** `/governance`
- **Audit** `/audit`
- **Access** `/access`

### SYSTEM

- **Services** `/system/services`
- **Deployments** `/system/deployments`
- **Configuration** `/system/config`

---

## 3. Global header

Always show:

```text
ENVIRONMENT        MAINNET / SEPOLIA / LOCAL
PROTOCOL STATUS    SOLVENT / DEGRADED / INCIDENT
CHAIN              BASE block + lag
ACTIVE TABLES
OPEN INCIDENTS
ADMIN WALLET
ROLE
```

Mainnet should be visually unmistakable.

Never let an operator think they are on Sepolia when they are on mainnet.

---

## 4. Shared primitives

Create under:

```text
apps/admin/src/components/control/
```

### `ControlShell`

- rail;
- header;
- identity footer;
- breadcrumb;
- stale-data indicator;
- environment indicator;
- optional incident banner.

### `ControlPageHeader`

Supports:

- title;
- description;
- range;
- status;
- refresh;
- export;
- safe actions.

### `ControlMetricCard`

Required fields:

```text
label
value
comparison
source
lastUpdated
status
```

### `ControlTable`

Features:

- server pagination;
- filters;
- sort;
- copyable IDs;
- sticky columns;
- CSV export;
- empty/error/stale states;
- row deep-links.

### `ControlHealthBadge`

Canonical states:

```text
HEALTHY
DEGRADED
CRITICAL
PENDING
STALE
UNAVAILABLE
UNDER_REVIEW
PAUSED
```

### `ControlDangerAction`

Must require:

- reason;
- action summary;
- expected effect;
- confirmation;
- step-up when necessary.

---

## 5. Global search

One search bar should resolve:

```text
wallet
profile id
display name
session id
table id
hand id
transaction hash
proof batch hash
settlement digest
incident id
admin action id
```

Search results must show entity type clearly.

---

## 6. Data freshness UX

Every page backed by operational data should show:

```text
Last updated 4s ago
Source: chain-indexer
```

If polling fails:

```text
STALE · last successful refresh 2m 14s ago
```

Never keep animating a green "LIVE" indicator after data stopped updating.

---

## 7. Polling strategy

Phase 1:

- Command Center: 5s.
- live tables: 2–5s.
- AI health: 5s.
- settlement queue: 5s.
- economics: 15–60s.
- historical/player pages: manual/30s.

Add WebSockets only where polling becomes insufficient.

---

## 8. Read vs control surfaces

Each page should visually separate:

```text
OBSERVE
ANALYZE
ACT
```

For example Session Detail:

```text
Overview
Timeline
Money
Randomness
Proofs
AI
Operations
Audit
```

The Operations tab contains the controlled mutation actions.

---

## 9. Action confirmation design

Never use a generic browser confirm dialog.

Critical action drawer:

```text
PAUSE NEW MATCHMAKING — LONDON $1/$2

Impact
• prevents new allocations
• active hands continue
• existing seated stacks unchanged
• current settlements continue

Reason [required]
Incident [optional/required depending tier]

Type "PAUSE LONDON" to confirm
[Cancel] [Pause]
```

---

## 10. Audit deep-linking

Every mutation confirmation should return:

```text
Action accepted
Audit #A-19342
Request #REQ-...
```

Clicking opens `/audit/:id`.

---

## 11. Mainnet UX protections

On mainnet:

- persistent MAINNET badge;
- destructive actions use red border;
- governed actions say `PREPARE PROPOSAL`, not `EXECUTE`;
- environment-specific confirmation phrase;
- no hidden keyboard shortcuts for destructive actions.
