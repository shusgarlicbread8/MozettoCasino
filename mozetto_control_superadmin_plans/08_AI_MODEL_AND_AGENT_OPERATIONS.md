# Mozetto Control — AI Model and Agent Operations

## 1. Goal

Operate the autonomous poker layer like a production inference platform while preserving fair-play boundaries.

---

## 2. AI Operations overview

Top cards:

```text
provider health
requests/min
p50/p95/p99 final latency
timeout rate
fallback rate
invalid response rate
schema repair rate
Energy / hand
COGS / hand
active AI seats
```

Break down by:

- provider;
- model;
- profile;
- city;
- street;
- environment.

---

## 3. Policy/version visibility

For every active session show:

```text
modelPolicyHash
masterPolicyHash
profileHash
scheduler policy id
Energy policy id
fallback policy id
agent-runtime commit
```

This is essential for reproducibility.

---

## 4. AgentState health

Show:

```text
store backend DB/memory
last persisted sequence
reconstruction status
opponent models count
range model status
review flag
persistence lag
```

Do not expose raw hidden chain-of-thought.

Structured fields are acceptable:

```text
opponent model confidence
street plan category
Energy remaining
range-update status
strategic intent
```

---

## 5. AI activity feed health

Operators need diagnostics for the user-facing thinking/activity feed:

```text
activity events produced
transient/final ratio
sequence gap count
duplicate count
persist latency
reconnect replay success
```

This catches the exact class of disappearing/renumbering feed bug seen during table development.

---

## 6. Provider controls

### Disable provider for new calls

Use when provider is degraded.

Existing in-flight calls may finish; active tables must follow deterministic fallback policy.

### Force fallback mode

For new decisions, temporarily bypass provider and use deterministic fallback if safety requires it.

### Stop new AI tables

Allows existing sessions to conclude while limiting exposure.

### Roll back policy deployment

Policy/version rollback should apply only at a safe boundary defined by the controller/session rules.

Never mutate an active hand's already committed profile/model policy hash.

---

## 7. Profile analytics

Per Shark/Fox/Professor/Machine:

```text
hands
VPIP
PFR
3bet
aggression
river bet rate
bluff rate
Energy by street
latency
fallback rate
bb/100 proxy
COGS / hand
```

Use this to validate that profiles are meaningfully distinct.

---

## 8. Evaluation page

Attach automated evaluation reports:

```text
profile separation
controlled bot exploits
memory-enabled vs disabled
Energy 50/100/unlimited comparison
provider/version bake-off
timeout/fallback stress
```

These are product-development metrics, not player-facing claims of guaranteed skill.

---

## 9. Incident thresholds

Open AI incident when:

- final-action timeout rate crosses threshold;
- fallback rate spikes;
- invalid schema responses spike;
- provider p95 exceeds action deadline margin;
- AgentState persistence fails;
- cost per hand jumps materially;
- profile hashes mismatch expected deployment.

---

## 10. Security boundaries

Control must not display:

- provider API keys;
- raw master system prompts if they contain sensitive implementation details unless operator role explicitly permits internal policy view;
- private chain-of-thought;
- hidden opponent hole cards.

Secrets page shows metadata only:

```text
configured: yes
last rotated: date
source: AWS Secrets Manager
```
