# MOZETTO_ENERGY_V1

| Field | Value |
|---|---|
| **Version string** | `MOZETTO_ENERGY_V1` |
| **Status** | `frozen` |
| **Work packet** | WP-014 |
| **Domains** | `ENERGY_OP_V1`, `ENERGY_LEDGER_V1` |

## 1. Normative terms

RFC 2119 **MUST** / **MUST NOT** / **SHOULD** / **MAY**.

## 2. Purpose

Energy is a **game resource** that equalizes compute opportunity across seats. It is not a user-visible token bill. The 15-second clock is the final-action deadline; cognition MAY occur earlier via scheduled background work within Energy limits.

## 3. Season 1 reset policy

- Each seat MUST start every hand with exactly **`100` Energy**.
- Unused Energy MUST expire at hand end.
- MUST NOT purchase, borrow, or accumulate across hands.
- All seats at a table MUST use the same Energy policy hash.

## 4. Mandatory reserve

While a seat is still active (not folded / not all-in finished for the hand), the scheduler MUST reserve at least **`12` Energy** for the final on-turn action.

Background cognition MUST NOT spend below this reserve.

## 5. Operation types and cost table

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

**These costs are Season 1 initial defaults / hypotheses**, not proven optima. Changes require a new `energyPolicyHash` / season — never silent mutation of an active season.

Combined final requests pay the highest relevant decision mode plus explicitly invoked memory cost. MUST NOT double-charge arbitrary internal details.

Energy MUST NOT be charged for provider requests that never execute (cancelled/preempted).

## 6. Cognitive scheduler outputs

```text
IGNORE
DETERMINISTIC_UPDATE
LIGHT_UPDATE
OPPONENT_UPDATE
STREET_PLAN
DEEP_REEVALUATION
```

Profiles MAY bias probabilities; users MUST NOT override the cost table or inject provider instructions (“ignore Energy”).

## 7. Energy operation hash

```text
energyOpHash = keccak256(abi.encode(
  DOMAIN_ENERGY_OP_V1,
  bytes32 sessionId,
  bytes32 handId,
  uint8   seat,
  uint32  opIndex,
  uint16  operationType,
  uint16  energyDebit,
  uint16  remainingEnergy,
  bytes32 providerRequestId,   // bytes32(0) if none
  bytes32 observationHash,
  bytes32 resultHash,
  bool    fallbackFlag
))
```

## 8. Energy ledger header

```text
energyLedgerHash = keccak256(abi.encode(
  DOMAIN_ENERGY_LEDGER_V1,
  bytes32 sessionId,
  bytes32 handId,
  uint8   seat,
  uint16  startingEnergy,      // MUST be 100 in Season 1
  bytes32 opsRoot,             // Merkle root of energyOpHash in opIndex order
  uint16  endingEnergy
))
```

Ledger is private during play; MAY be summarized after the hand. Include root in hand root when competitive verification requires it.

### Fairness audit requirements

For any hand, an auditor MUST be able to prove:

- every seat started at 100;
- each operation used the frozen cost table;
- no seat spent more than 100;
- reserve rule held;
- model/profile hashes matched the sealed session;
- no unrecorded inference affected the action (production traffic via audited gateway).

## 9. Timing budget (initial default / hypothesis)

Final-action internal budget recommendation:

```text
0.0–0.4s   construct/validate observation
0.4–1.0s   select mode / memory
1.0–10.0s  Groq decision
10.0–12.0s one repair retry if allowed
12.0–15.0s cadence/fallback/commit safety
```

Public cadence is strategic and bounded; provider latency is private telemetry.

## 10. Degraded behavior

- Low Energy: stop background first; use standard/minimal final; fallback remains.
- Provider congestion: prioritize finals; skip background; no charge for non-executed calls.
- AgentState corruption: reconstruct from public events + last checkpoint; else fallback + review flag.

## 11. Example values

Golden vector `11_energy_ledger_hand.json` (debits 0+4+6+8 → end 82).

## 12. Invalid examples

- Starting Energy ≠ 100 in Season 1.
- Background spend leaving `< 12` while still active.
- Carrying Energy across hands.
- Charging cancelled calls.
- User prompt disabling Energy.

## 13. Compatibility / upgrade

- Cost table changes require new `energyPolicyHash` and season/template binding.
- Historical ledgers remain verifiable under the sealed policy.
