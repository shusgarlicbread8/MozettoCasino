# Mozetto Control — Command Center and Observability

## 1. Goal

The Command Center is the answer to:

> Is Mozetto safe and operating normally right now?

It should require no navigation to detect a serious issue.

---

## 2. API

Create:

```http
GET /v1/admin/overview?range=1d|7d|30d
```

Response groups:

```text
status
economics
activity
custody
settlement
randomness
ai
infrastructure
incidents
```

Do not make the route a fragile synchronous fanout to every service on every request. Use bounded parallel calls and explicit partial states.

Example status:

```json
{
  "status": "DEGRADED",
  "generatedAt": "...",
  "components": {
    "solvency": { "status": "HEALTHY", "ageMs": 1300 },
    "ai": { "status": "DEGRADED", "ageMs": 440 },
    "randomness": { "status": "HEALTHY", "ageMs": 850 }
  }
}
```

---

## 3. Hero status row

Cards:

### Protocol solvency

```text
SOLVENT
Vault assets
Open liabilities
Protocol fees
Difference
```

### Active play

```text
active tables
seated players
hands/min
queued match intents
```

### Economics today

```text
gross rake
AI COGS
chain/VRF cost
contribution
```

### Settlement

```text
pending settlements
oldest pending age
failed/retry count
attestor quorum status
```

### Incidents

```text
critical
high
open total
```

---

## 4. Service topology

Display a compact dependency graph:

```text
Web/Admin
   ↓
API ────────────────┐
   ↓                │
Game Server         │
   ↓                │
Agent Runtime       │
Dealer              │
Replay Verifier     │
   ↓                │
DB / Redis          │
   ↓                │
Indexer → Reconcile │
   ↓                │
Settlement Worker ──┤
   ↓                │
Base Contracts ◄────┘
```

Each node shows:

- healthy/degraded/down;
- version/commit;
- last heartbeat;
- latency;
- queue depth where relevant.

---

## 5. Activity metrics

By city/stake pool:

```text
seated players
active tables
hands/hr
average pot
average session duration
join wait p50/p95
seat utilization
bust rate
leave rate
top-up rate
```

This turns Control into a product operations tool, not only a protocol tool.

---

## 6. AI metrics

Show:

```text
provider p50/p95/p99
final-action timeout rate
fallback rate
schema repair rate
illegal proposal rate
Energy / hand
background calls / hand
tokens / hand
COGS / hand
```

Break down by profile and city.

---

## 7. Settlement and proof metrics

Show:

```text
settlements/min
pending count
oldest pending
failed submissions
quorum failures
proof batches published
proof batch gap count
watchtower failures
indexer lag
reconciliation drift
```

---

## 8. Alert policy

Examples:

### Critical

- solvency difference != 0 after confirmation window;
- settlement conservation failure;
- verified proof continuity break;
- unauthorized admin action;
- protocol contract address/code mismatch.

### High

- settlement oldest > threshold;
- indexer lag > threshold;
- VRF fulfillment stalled;
- dealer attestation unhealthy;
- agent timeout/fallback spike;
- Redis lease failure affecting tables.

### Medium

- economics margin negative in city;
- unusually high disconnect rate;
- elevated pair-cap/restriction hits;
- stale historical materialized views.

---

## 9. Command Center quick actions

Only safe runtime controls:

```text
Pause new ranked matches
Drain city after hands
Disable AI provider for new decisions
Open incident
Request global reconciliation
Request watchtower verification
```

Chain changes link to Governance proposal preparation.

---

## 10. Acceptance

- one failed dependency does not blank the page;
- metric authority and age are visible;
- stale data cannot display as live;
- critical solvency divergence creates/links incident;
- every quick action generates audit record.
