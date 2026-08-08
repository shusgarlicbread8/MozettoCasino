# Mozetto Control — Table, Session and Matchmaking Operations

## 1. Goal

Make it possible to safely operate live tables without changing the poker state machine.

---

## 2. Sessions list

Columns:

```text
session id
table id
city/stakes
seats
hand number
status
started
duration
pot
locked funds
settlement state
randomness state
AI health
review state
```

Filters:

```text
ACTIVE
PAUSED
SETTLING
UNDER_REVIEW
FAILED
city
stakes
profile
AI provider
age
```

---

## 3. Session detail

Tabs:

### Overview

- lifecycle state;
- GameTemplate/template hash;
- participants;
- buy-ins;
- current stacks;
- current hand;
- queued seat changes.

### Canonical timeline

- hand events;
- event hash chain;
- outbox delivery state.

### Money

- initial locks;
- top-ups;
- current stacks;
- rake;
- expected final settlement;
- custody status.

### AI

- profile;
- Energy;
- decision latency;
- fallback status;
- policy/model version;
- AgentState persistence health.

### Randomness

- secret commitment;
- VRF request/fulfillment;
- deck batch root;
- public openings.

### Verification

- hand root;
- balance root;
- proof batch inclusion;
- replay verifier;
- watchtower.

### Operations

Safe runtime actions.

---

## 4. Safe table controls

### Pause after hand

Semantics:

```text
requested now
→ current hand continues
→ next hand is not dealt
→ table enters PAUSED
```

### Drain table

```text
no new seats
current hands complete
seated users leave/settle according to lifecycle
close when safe
```

### Under review

Adds operational flag and risk context; does not rewrite state.

### Request replay

Queues verifier job and attaches result.

### Disable new seats

Stops join allocation while leaving active seats untouched.

### Resume

Requires safety checks:

- no unresolved critical incident;
- lease healthy;
- randomness pipeline healthy;
- state replay valid.

---

## 5. Matchmaking page

Show per city:

```text
queue size
wait p50/p95
available tables
seat utilization
match allocations/min
rejected intents
pair-cap rejections
rat-hole rejections
integrity rejections
```

Controls:

- pause new ranked intents globally;
- pause one city;
- resume;
- drain city;
- adjust **operational** soft limits only if explicitly configured for runtime.

Stake/blind/buy-in GameTemplate changes go through governance/template process, not a hidden slider.

---

## 6. Hand-boundary controls

Control should understand the same lifecycle as players.

If an operator requests table pause during a hand:

```text
PAUSE_REQUESTED
→ hand resolves
→ queued leave/sit-out/top-up applied as normal
→ PAUSED
```

Never abort a healthy current hand merely for convenience.

---

## 7. Actor/lease diagnostics

Show:

```text
actor owner instance
lease version
fencing token
lease expiry
last heartbeat
recovery status
last durable event sequence
outbox depth
```

If lease is lost, operators should see why the table stopped.

---

## 8. Failure actions

### Game server crash

- table shows RECOVERING;
- lease reclaim status;
- replay validation;
- resume only after durable tip matches.

### DB unavailable

- persist-before-broadcast policy should stop unsafe mutation;
- UI explains stalled state;
- do not offer "force continue".

### Settlement delayed

- table/session remains settling;
- user funds state remains visible;
- operator can request retry/replay according to worker semantics;
- no manual balance correction button.

---

## 9. Audit

Every operation records:

```text
session/table
actor
reason
before status
after status
request/result
linked incident
```
