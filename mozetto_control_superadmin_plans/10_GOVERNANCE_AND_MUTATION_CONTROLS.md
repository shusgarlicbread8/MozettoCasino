# Mozetto Control — Governance and Mutation Controls

## 1. Principle

Every dangerous action must be either:

1. an explicitly bounded runtime operation; or
2. a proposal to the actual governance authority.

There must be no ambiguous third category.

---

## 2. Capability classification

### Tier 0 — Read

No confirmation beyond auth.

### Tier 1 — Review/admin metadata

Examples:

- mark session under review;
- attach note;
- request replay.

Require reason + audit.

### Tier 2 — Runtime exposure controls

Examples:

- pause new matchmaking;
- drain city;
- disable provider for new calls;
- pause table after hand.

Require:

- capability;
- reason;
- impact preview;
- optional incident;
- fresh admin session;
- audit.

### Tier 3 — Governed protocol mutation

Examples:

- GameTemplate changes;
- fee vault treasury changes;
- verifier/quorum changes;
- registry changes;
- timelock changes.

Control only prepares proposal.

### Tier 4 — Emergency guardian

Must be treated as a separate operational credential/path.

---

## 3. Governance proposal workflow

```text
Choose action
→ enter parameters
→ validate against current chain state
→ generate before/after diff
→ simulate
→ risk summary
→ calldata
→ Safe Tx Builder JSON
→ optional timelock wrapping
→ archive proposal
→ external signing/execution
→ ingest receipt
→ verify post-state
```

---

## 4. Change preview

Every proposal should show:

```text
Current value
Proposed value
Affected contract
Affected GameTemplates/sessions
Timelock delay
Can active sessions change? no/yes
Rollback path
```

No proposal should be generated if it would violate an explicit protocol invariant detectable by Control.

---

## 5. Simulation

Where possible use `eth_call` / fork simulation to show:

- revert/success;
- expected events;
- affected storage/view values.

Label simulation clearly as simulation.

---

## 6. Proposal archive

Store:

```text
proposal id
creator wallet
created at
action type
parameters
calldata hash
Safe JSON hash
simulation result
linked incident/change ticket
status
execution tx
post-verification
```

---

## 7. Runtime mutation idempotency

Critical admin mutations should accept:

```text
Idempotency-Key
```

and persist request/result.

Repeated browser submission must not produce duplicate effects.

---

## 8. Kill switches

Define them explicitly rather than sprinkling feature flags.

Recommended:

```text
new_ranked_matchmaking
new_onchain_sessions
new_ai_sessions
city:<id>:new_matches
provider:<id>:enabled
proof_publisher_enabled
```

Each has:

- owner service;
- default;
- reason;
- changed by;
- changed at;
- incident link;
- safe resume checklist.

Never use a kill switch to mutate already-settled money.

---

## 9. Principal management

Superadmin can:

- create/disable principal;
- assign role;
- revoke sessions.

Principal changes are themselves highly privileged and require step-up signature and audit.

---

## 10. Separation of duties

For mainnet, strongly consider requiring two different people/roles for certain actions:

```text
operator proposes platform-wide pause
superadmin approves
```

or:

```text
governance preparer generates proposal
Safe signers execute externally
```

This is more important than making one wallet omnipotent.
