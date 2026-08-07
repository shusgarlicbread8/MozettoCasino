# WP-074 — Energy ledger

**Authority:** `specs/MOZETTO_ENERGY_V1.md` (frozen), Plan 09, WP-074 in `16_AGENT_WORK_PACKETS.md`  
**Vectors:** `specs/canonical-vectors/11_energy_ledger_hand.json` (+ policy label in vector 10)  
**Prior:** WP-072 AgentState store (`services/agent-runtime/src/state/`)  
**Date:** 2026-08-07

---

## Delivered

| Item | Location |
|---|---|
| Season 1 cost table + policy hash | `services/agent-runtime/src/energy/costs.ts` |
| Ledger types | `services/agent-runtime/src/energy/types.ts` |
| `ENERGY_OP_V1` / `ENERGY_LEDGER_V1` + Merkle | `services/agent-runtime/src/energy/hash.ts` |
| grant / debit / reserve / expire APIs | `services/agent-runtime/src/energy/ledger.ts` |
| AgentState `energyRemaining` sync | `services/agent-runtime/src/energy/agent-hook.ts` |
| `EnergyLedgerStore` + in-memory / Postgres writers | `services/agent-runtime/src/energy/store.ts`, `memory-store.ts`, `db-store.ts`, `factory.ts` |
| Unit tests (vector 11, overspend, reserve, cancel, mocked DB) | `services/agent-runtime/src/energy/energy.test.ts`, `db-store.test.ts` |
| Export | `@mozetto/agent-runtime/energy` |

---

## Product rules (Season 1)

- Each seat **MUST** start every hand with exactly **100** Energy (`grantHandEnergy`).
- Unused Energy **MUST** expire at hand end (`expireUnusedEnergy`) — no purchase, borrow, or cross-hand carry.
- While the seat is still active (not folded / not all-in finished), background cognition **MUST NOT** leave remaining Energy `< 12` (`MANDATORY_RESERVE`).
- Final-decision modes **MAY** spend into the reserve.
- Provider calls that never execute (`executed: false`) **MUST NOT** be charged.
- Combined finals: highest decision mode + optional memory cost (`combinedFinalDebit`) — do not double-charge internals.
- All seats at a table share the same `energyPolicyHash` (`energy-policy-season1-100-v1`).

Continuous cognition **scheduler loops are not started** (WP-073). These APIs are what the scheduler will call.

---

## Season 1 cost table (hypotheses)

Exact debit amounts are **Season 1 initial defaults / hypotheses**, not proven optima. Changes require a new `energyPolicyHash` / season — never silent mutation of an active season.

| Code | Operation | Energy |
|---:|---|---:|
| 1 | `DETERMINISTIC_INGEST` | 0 |
| 2 | `LIGHT_UPDATE` | 2 |
| 3 | `TIMING_UPDATE` | 2 |
| 4 | `OPPONENT_UPDATE` | 4 |
| 5 | `STREET_PLAN` | 6 |
| 6 | `MEMORY_RETRIEVAL` | 3 |
| 7 | `STANDARD_FINAL_DECISION` | 8 |
| 8 | `DEEP_FINAL_DECISION` | 16 |
| 9 | `MAXIMUM_FINAL_DECISION` | 24 |

`ENERGY_POLICY_HASH = keccak256(bytes("energy-policy-season1-100-v1"))` (matches vector 10).

---

## Scheduler call surface (WP-073 later)

```text
grantHandEnergy({ sessionId, handId, seat })     → remaining 100
debitEnergy(ledger, { operationType, … })          → reject overspend / reserve / cancelled
setSeatActive(ledger, false)                       → release reserve after fold/all-in
expireUnusedEnergy(ledger)                         → endingEnergy + opsRoot + ledgerHash
syncEnergyToAgentState(state, ledger)              → AgentState.energyRemaining
```

Audit hashes use frozen `@mozetto/protocol-vectors` encoders (`energyOpHash`, `energyLedgerHash`, ordered Merkle).

Golden hand (vector 11): debits `0+4+6+8` → end **82**; reserve never breached.

---

## AgentState hook

`AgentStateV1.energyRemaining` remains the live mirror field (created at 100 by WP-072). After each successful ledger mutation, call `syncEnergyToAgentState`. Next hand: new `createEmptyAgentState` + new `grantHandEnergy` — do not reuse expired remaining.

---

## Persistence

1. **In-memory** (`InMemoryEnergyLedgerStore`) — local/dev default (`ENERGY_LEDGER_STORE=memory`).
2. **Postgres** (`DbEnergyLedgerStore`) — upserts `agent_energy_ledgers` (migration `026`) when `ENERGY_LEDGER_STORE=db` and `DATABASE_URL` is set (or inject `createEnergyLedgerStore({ exec })`).
3. Pure grant/debit/expire APIs stay in `ledger.ts`; stores snapshot the resulting `EnergyLedger` (`ops_json` + header fields).

| Env | Default | Notes |
|---|---|---|
| `ENERGY_LEDGER_STORE` | `memory` | `db` / `postgres` / `pg` selects Postgres writer |
| `DATABASE_URL` | — | Required for `db` mode unless `exec` is injected |

Does **not** claim hosted migrations have been applied.

---

## Not in scope

- WP-073 continuous cognition scheduler / priority queue
- Spec / golden vector mutations
- `contracts/` changes
- Hosted `DATABASE_URL` migrate apply (operator responsibility)
