# Mozetto Control — Incidents, Security, Audit and Runbooks

## 1. Incident model

Statuses:

```text
OPEN
ACKNOWLEDGED
MITIGATING
MONITORING
RESOLVED
POSTMORTEM
```

Severities:

```text
SEV0 — player money/protocol integrity at immediate risk
SEV1 — major production impairment
SEV2 — partial degradation
SEV3 — low-impact issue
```

---

## 2. Incident schema

```text
id
title
severity
status
source
affected environments
cities/tables/sessions/users
opened_at
owner
summary
mitigation
linked admin actions
linked deployments
linked chain txs
resolved_at
postmortem url
```

---

## 3. Automatic incident sources

Create incidents or alerts from:

- reconciliation divergence;
- watchtower verification failure;
- settlement queue age;
- VRF timeout;
- dealer/TEE attestation failure;
- indexer lag/reorg failure;
- AI fallback spike;
- DB/Redis outage;
- unauthorized admin access pattern;
- contract code mismatch.

---

## 4. Core runbooks

### Solvency mismatch

1. automatically pause new on-chain matchmaking;
2. preserve active session state;
3. snapshot reconciliation sources;
4. compare chain vs indexer vs DB;
5. run independent watchtower/reconciliation;
6. open SEV0;
7. do not perform manual ledger credit/debit;
8. escalate to protocol/governance recovery if required.

### Settlement backlog

1. inspect worker health;
2. inspect attestor quorum;
3. inspect RPC/gas;
4. retry idempotently;
5. drain new exposure if age threshold exceeded;
6. surface user settling balances honestly.

### VRF stalled

1. stop opening sessions that require a new randomness epoch;
2. allow already-ready hands/sessions according to protocol;
3. inspect subscription/funding/request confirmations;
4. do not reroll randomness.

### AI provider outage

1. mark provider degraded;
2. deterministic fallback according to policy;
3. stop new AI tables if fallback quality/risk threshold exceeded;
4. preserve current hand integrity.

### Game server crash

1. actor lease reclaim;
2. replay durable events;
3. validate hash tip;
4. resume only if state reconstruction passes.

---

## 5. Audit log

`admin_actions` must remain append-only.

Recommended fields:

```text
id
actor_subject
actor_label
role
auth_method
capability
action_type
environment
entity_type
entity_id
request_id
idempotency_key
reason
before_json
after_json
result_json
incident_id
created_at
```

---

## 6. Audit UI

Filters:

```text
actor
role
action
entity
environment
success/failure
incident
time
```

Detail view should display structured before/after diffs.

---

## 7. SIEM/export

Provide append-only export to external storage/SIEM.

Never make the same database row the only historical record for production critical changes.

---

## 8. Configuration/secrets view

Control may show:

```text
GROQ_API_KEY        configured · rotated 12d ago
ADMIN_SESSION_SECRET configured · rotated 31d ago
DATABASE_URL        configured
```

It must never return secret values to the browser.

---

## 9. Deployment history

Record:

```text
service
version/commit
image digest
deployed at
deployer
status
rollback target
```

Link deployments to incidents and metric changes.

---

## 10. Security acceptance

- audit rows cannot be modified/deleted through application role;
- unauthorized mutation attempts are logged;
- session revoke is immediate;
- all mainnet dangerous actions require explicit reason;
- secrets never appear in API payloads;
- no private chain keys in browser bundle.
