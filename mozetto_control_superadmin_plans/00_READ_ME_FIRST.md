# Mozetto Control — Read Me First

**Purpose:** Turn the existing `apps/admin` operations dashboard into a production-grade, wallet-gated control plane for operating Mozetto without turning the admin frontend into a custody or protocol super-key.

**Scope:** Player support, sessions/tables, matchmaking, AI operations, economics, treasury visibility, solvency, randomness, proof/settlement health, incidents, risk review, governance proposal preparation, audit, deployment health, and controlled operational actions.

**Non-goal:** A browser wallet with unilateral authority over player balances, custody contracts, treasury funds, upgrades, or settlement outcomes.

---

## 1. Product doctrine

Mozetto Control must follow four hard rules.

### Rule A — The admin UI is an operations cockpit, not a chain super-key

The connected admin wallet authenticates the human operator. It does **not** gain custody authority merely because it can sign into Control.

Critical chain powers remain separated:

- Protocol ownership → Protocol Safe / timelock.
- Treasury movement → Treasury Safe.
- Emergency guardian powers → dedicated guardian role/key path.
- Attestation/settlement keys → service/attestor infrastructure.
- Session signer / relayer keys → server-side infrastructure only.
- Player ArenaAccount ownership → player wallet only.

Control may prepare calldata, simulate it, display consequences, archive proposals, and export Safe Transaction Builder payloads. It must not contain Protocol Safe or Treasury Safe private keys.

### Rule B — No silent balance edits

There must be no generic admin endpoint such as:

```text
POST /admin/users/:id/set-balance
POST /admin/ledger/credit
POST /admin/vault/force-payout
```

Real-money correction paths must use the protocol's actual settlement/emergency mechanisms or a separately governed migration/recovery procedure.

### Rule C — Current hands are immutable from operations UI

Operations can:

- stop new matchmaking,
- pause a table **after the current hand**,
- mark a session under review,
- request replay/verification,
- disable future AI seating,
- drain a city after active hands settle.

Operations cannot:

- change hole cards,
- change the board,
- change the pot,
- alter an already accepted action,
- replace an agent profile mid-hand,
- rewrite canonical events,
- change final balances directly.

### Rule D — Every mutation is attributable

Every privileged action must produce an append-only audit event containing at least:

```text
actor wallet
admin principal
role
session id
request id
reason
before state
requested state
result
IP / user-agent metadata where appropriate
timestamp
linked incident/change ticket
```

---

## 2. Existing primitives to preserve

Do not rebuild what already exists.

The current stack already contains:

- `apps/admin` on port `3001`.
- Admin solvency surfaces.
- Admin sessions/randomness/AI views.
- `admin_principals` and append-only `admin_actions`.
- Read vs mutate admin roles/tokens.
- Narrow session operations such as pause-after-hand / under-review / replay request.
- Governance proposal generation without browser private keys.
- Reconciliation worker / auto-pause concepts.
- Watchtower and public Verify Game surfaces.
- Treasury/unit-economics surfaces.

Mozetto Control should unify and deepen these surfaces rather than introduce another admin app.

---

## 3. Authority ladder

Whenever two data sources disagree, Control must make the authority obvious.

Recommended authority order:

```text
1. On-chain contract state / finalized receipts
2. Canonical game event log / signed settlement artifacts
3. Chain indexer projection
4. Reconciliation worker result
5. Postgres operational mirror
6. Cached/aggregated admin read models
7. Browser state
```

Never display a cached value as authoritative if an upstream authority is unavailable.

Use states like:

```text
VERIFIED
PENDING
STALE
DIVERGED
UNAVAILABLE
REQUIRES_REVIEW
```

instead of defaulting to green.

---

## 4. Control taxonomy

Every action in the product must belong to one tier.

| Tier | Name | Examples | Execution model |
|---|---|---|---|
| 0 | Read | metrics, sessions, user P&L | immediate |
| 1 | Soft ops | mark under review, request replay | immediate + audit |
| 2 | Runtime control | pause new matches, drain city, provider disable | step-up confirmation + audit |
| 3 | Governed chain change | template change, verifier/router change | proposal only → Safe/timelock |
| 4 | Emergency | guardian pause / emergency procedure | dedicated policy, explicit incident, external key path |

The UI must visually distinguish these tiers.

---

## 5. First-release information architecture

```text
CONTROL
├─ Command Center
├─ Economics
├─ Players
├─ Tables & Sessions
├─ Matchmaking
├─ AI Operations
├─ Risk & Integrity
├─ Solvency
├─ Treasury
├─ Randomness
├─ Proofs & Settlement
├─ Chain
├─ Incidents
├─ Governance
├─ Audit
└─ System
```

The app should feel like a dense operational cockpit, not like a consumer dashboard.

---

## 6. Immediate release sequence

Do not start UI reskinning before shipping the current uncommitted state.

### Gate 0 — repository clean

1. Apply all pending migrations through the latest migration, including AI activity persistence.
2. Verify migration status against local and hosted targets.
3. Commit current poker table / AI / bust/top-up / feed work.
4. Push the known-good baseline.
5. Record commit SHA in the Control progress tracker.

### Gate 1 — admin authentication

Build SIWE admin identity and role lookup.

### Gate 2 — shell

Re-shell existing admin pages into the new Control IA without changing backend semantics.

### Gate 3 — read-side depth

Build Command Center, economics, player drilldown, table drilldown, AI health, chain/proof health.

### Gate 4 — safe controls

Add only the operations that have explicit lifecycle semantics and audit coverage.

### Gate 5 — security/release hardening

Threat model, E2E auth tests, mutation tests, chaos, rate limits, session revocation, audit export, staging deployment.

---

## 7. Definition of "powerful"

A powerful superadmin is **not** one that can edit everything.

It is one that lets an authorized operator answer these questions in seconds:

- Is player money safe?
- Is protocol solvency exact?
- What is currently broken?
- Which tables are affected?
- Which users are affected?
- Are settlements progressing?
- Is randomness healthy?
- Are agents timing out?
- What is our rake revenue right now?
- What is AI compute costing us?
- Which city/stake pool is profitable?
- Is a player exploiting pairing or rat-hole rules?
- Is a table safe to pause after the hand?
- Can we stop new exposure without touching existing money?
- What changed, who changed it, and why?
- What chain proposal is required to fix a governed parameter?

If Control answers those reliably, it is doing its job.
