# Mozetto Control — Data, API and Database Plan

## 1. Principle

Build read models for operator speed without confusing them with financial authority.

---

## 2. Suggested migrations

Exact numbering should be allocated from the repository's current head at implementation time.

### Admin wallet sessions

```text
admin_siwe_nonces
admin_sessions
```

Only add if an equivalent current table does not already exist.

### Player reporting view

```text
admin_player_stats_v1
```

A view over existing profiles, wallet bindings, sessions, hands, rake and ledger projections.

### Incident system

```text
security_incidents / ops_incidents
incident_events
incident_entity_links
```

Reuse existing incident table if already present rather than duplicating.

### Proposal archive

```text
governance_proposals
```

Only if current governance package does not already persist proposals.

---

## 3. API surface

### Auth

```http
GET  /v1/admin/auth/nonce
POST /v1/admin/auth/verify
POST /v1/admin/auth/logout
GET  /v1/admin/me
POST /v1/admin/auth/step-up
```

### Overview

```http
GET /v1/admin/overview
```

### Economics

```http
GET /v1/admin/economics
GET /v1/admin/economics/cities
GET /v1/admin/treasury
```

### Players

```http
GET /v1/admin/players
GET /v1/admin/players/:id
GET /v1/admin/players/:id/sessions
GET /v1/admin/players/:id/integrity
POST /v1/admin/players/:id/restrictions
```

### Sessions

```http
GET  /v1/admin/sessions
GET  /v1/admin/session/:id
POST /v1/admin/session/:id/ops
```

### Matchmaking

```http
GET  /v1/admin/matchmaking
POST /v1/admin/matchmaking/ops
```

### AI

```http
GET  /v1/admin/ai/health
GET  /v1/admin/ai/economics
GET  /v1/admin/ai/profiles
GET  /v1/admin/ai/deployments
POST /v1/admin/ai/ops
```

### Protocol

```http
GET /v1/admin/solvency
GET /v1/admin/chain
GET /v1/admin/randomness
GET /v1/admin/settlements
GET /v1/admin/proofs
GET /v1/admin/watchtower
```

### Incidents

```http
GET  /v1/admin/incidents
POST /v1/admin/incidents
GET  /v1/admin/incidents/:id
POST /v1/admin/incidents/:id/events
```

### Governance

```http
POST /v1/admin/governance/preview
POST /v1/admin/governance/proposals
GET  /v1/admin/governance/proposals
```

### Audit

```http
GET /v1/admin/audit
GET /v1/admin/audit/:id
```

---

## 4. Response envelope

Use consistent metadata:

```json
{
  "data": {},
  "meta": {
    "generatedAt": "...",
    "source": "chain-indexer",
    "sourceBlock": 123,
    "stale": false,
    "requestId": "..."
  }
}
```

For aggregated endpoints, report per-component sources.

---

## 5. Pagination

Lists must be server-paginated.

Prefer cursor pagination for high-volume tables:

```text
hands
audit events
players
sessions
incidents
```

Avoid loading entire history into admin browser.

---

## 6. Money representation

All authoritative money fields should be transported as decimal strings / atomic-unit strings, not floating JS numbers.

Example:

```json
{
  "usdcAtoms": "123450000",
  "display": "123.45"
}
```

Server controls formatting semantics.

---

## 7. Database roles

Separate:

- migration role;
- API application role;
- worker roles where possible;
- admin reporting role;
- read-only analytics role.

Admin API should not use a database role capable of arbitrary migration/DDL in production.

---

## 8. Sensitive data

Do not return:

- secret values;
- private keys;
- raw unrevealed cards;
- provider API keys;
- database credentials;
- raw private cognition/CoT.

---

## 9. Caching

Safe to cache:

- historical economics;
- closed sessions;
- deployment history.

Do not aggressively cache:

- solvency;
- active session state;
- incident status;
- current settlement queue.

---

## 10. Query budgets

Each endpoint should define:

```text
max time range
max rows
pagination limit
DB timeout
service timeout
```

An admin dashboard must not be able to take down production DB by asking for "all hands ever".
