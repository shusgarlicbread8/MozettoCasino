# Pause / unpause runbook (testnet)

**Authority:** `docs/WP-103_PUBLIC_TESTNET_PROGRAM.md`, governance `docs/WP-093_SAFE_TIMELOCK.md`  
**Network:** Base Sepolia (84532) staging only — never run against mainnet from this packet.

Use distinct staging operator keys. **Never** use Anvil default private keys on public networks.

---

## When to pause

| Trigger | Minimum action |
|---|---|
| Solvency unexplained difference (P0) | Matchmaking off **and** vault pause |
| Suspected double-pay / forged settlement | Vault pause + freeze settlement worker submits |
| Attestor quorum loss / key suspicion | Matchmaking off; rotate via dual control after incident lead OK |
| VRF / dealer prolonged outage (P1) | Matchmaking off (vault pause optional) |
| Planned maintenance | Matchmaking off; announce window |

---

## Layer 1 — stop new sessions (fast)

1. Admin: disable ranked/instant intents or set `pause_after_hand` / under-review per session ops (`docs/WP-094_AUDIT_RBAC.md`, `docs/WP-092_ADMIN_OPS_DASHBOARD.md`).
2. Confirm reconciliation worker will not auto-open matchmaking while critical checks fail (`docs/WP-083_RECONCILIATION_WORKER.md`).
3. Status note for Stage B/C testers within 1 hour if P0.

## Layer 2 — ArenaVault pause

Build / execute via governance (preferred) so actions are auditable:

```bash
# Example — fill --to from chain-manifest after live deploy (not null)
pnpm --filter @mozetto/governance propose -- \
  --action arenaVault.pause \
  --to 0xYOUR_SEPOLIA_VAULT \
  --chain-id 84532 \
  --mode timelockController \
  --timelock 0xYOUR_TIMELOCK \
  --delay 86400
```

If emergency guardian path exists on staging and delay is unacceptable for P0, follow the **documented** guardian procedure only — still dual-control, still audit-logged.

Confirm:

- [ ] New locks rejected
- [ ] In-flight hands: decide drain-vs-abort per incident lead (prefer finish hand then pause_after_hand when safe)

## Layer 3 — template / registry freeze (optional)

Schedule GameRegistryV2 template deactivation if you must block new game types while vault remains up (`gameRegistry` actions in WP-093).

## Layer 4 — settlement / publisher freeze

- Pause settlement-worker / proof-batch publisher deploys or set ops kill switch.
- Do **not** delete pending outbox rows; drain after fix (`docs/WP-081_PERSIST_OUTBOX.md`).

---

## Unpause sequence

1. Solvency dashboard + `compareBalances` green (`docs/WP-091_ADMIN_SOLVENCY_DASHBOARD.md`).
2. Watchtower / Verify Game sample session coherent.
3. Incident lead written sign-off.
4. Unpause vault (`arenaVault.unpause` via same governance path).
5. Re-enable matchmaking with **Stage caps restored** (do not silently raise caps).
6. Post-incident note → WP-104 if security/protocol related.

---

## Contacts / artifacts to capture

- Session IDs, hand IDs, tx hashes, proof-batch sequence, attestor addresses used
- Admin audit log entries (WP-094)
- Manifest `protocolVersion` + git commit of hosted images
