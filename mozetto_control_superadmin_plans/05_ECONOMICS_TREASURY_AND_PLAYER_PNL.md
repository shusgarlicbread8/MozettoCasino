# Mozetto Control — Economics, Treasury and Player P&L

## 1. Goal

Answer:

- How much money is the platform making?
- Where is it making it?
- What does each hand cost?
- Is rake covering AI + chain + infrastructure?
- How much is owed to players?
- What is the treasury/fee-vault state?

without giving the admin browser arbitrary spend authority.

---

## 2. Canonical economic definitions

Freeze definitions before UI.

### Gross rake

Sum of canonical hand/session rake accrued to protocol.

### AI COGS

Actual provider charge attributable to agent decisions/background cognition.

### Chain COGS

Gas, VRF, proof registration, settlement transaction cost, relayer cost.

### Infra COGS

Allocated compute/database/Redis/egress/observability cost.

### Contribution margin

```text
Gross rake
- AI COGS
- chain COGS
- allocated infra COGS
```

Never mix player winnings/losses into platform revenue for peer-vs-peer poker.

---

## 3. Economics page

Range:

```text
24H | 7D | 30D | custom
```

Top metrics:

```text
Gross rake
AI COGS
Chain COGS
Infra COGS
Contribution
Contribution margin %
Hands
Rake / hand
COGS / hand
```

Charts:

- rake vs COGS;
- contribution by city;
- AI COGS by profile/provider;
- gas/VRF/proof cost trend;
- hands and revenue overlay.

---

## 4. Per-city economics

Table:

```text
City
Stakes
Hands
Active users
Gross pot volume
Rake
AI cost
Chain cost
Contribution
Margin
Avg session
```

This is essential because Monaco and Berlin should not be assumed to have the same unit economics.

---

## 5. Treasury page

Read-only financial state:

```text
ProtocolFeeVault accrued
Treasury Safe address
last sweep
pending sweep amount
vault player liabilities
ArenaAccount aggregate
settling obligations
chain balances
reconciliation status
```

The browser must not contain a `Send` button backed by a hot private key.

Allowed:

```text
Prepare sweep proposal
Copy Safe JSON
Open Safe
```

---

## 6. Player P&L

`GET /v1/admin/players`

Suggested fields:

```text
profileId
wallet
arenaAccount
currentAvailable
atTables
settling
lifetimeDeposits
lifetimeWithdrawals
sessionNet
rakeContributed
hands
sessions
rating
riskState
lastActiveAt
```

### Player detail

Tabs:

- Overview;
- Money;
- Sessions;
- Hands;
- Rating;
- AI profiles;
- Integrity;
- Admin history.

---

## 7. Session P&L

For each session:

```text
opening stack
additional top-ups
final stack
net poker result
rake contributed
AI cost allocated
rating delta
settlement tx
```

Keep platform cost separate from player cash result unless the product explicitly charges it to player.

---

## 8. SQL view

If existing normalized tables make listing too expensive, create a read-only view rather than an opaque ETL first.

Example:

```sql
CREATE VIEW admin_player_stats_v1 AS
SELECT ...
```

Do not make this view authoritative for balances. It is a reporting projection.

---

## 9. Exports

CSV exports should include:

- selected filters;
- generated timestamp;
- environment;
- schema version.

Record export in audit log for sensitive/player datasets.

---

## 10. Finance controls

Control may allow:

- request reconciliation;
- prepare fee sweep governance/Safe action;
- export reports;
- flag accounting mismatch;
- open incident.

Control must not allow:

- edit player balance;
- redirect withdrawals;
- change settlement destination;
- arbitrary treasury transfer from a browser hot key.
