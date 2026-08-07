# Mozetto findings register

**Authority:** `docs/WP-104_AUDIT_REMEDIATION.md`, Plan 14 audit streams, Plan 17 testing/audit checklist  
**Machine source of truth:** `docs/audits/register.yaml`  
**Check:** `pnpm audit:register-check`  
**Last updated:** 2026-08-07

> **Honest status:** No paid/external multi-stream audit report is claimed complete. Rows below are scaffold templates, one example closed **process** finding, and documented residual engineering gaps (e.g. WP-100 `PASS_WITH_GAPS`). Do not invent Critical vulns “from an auditor.”

---

## Severity (summary)

| Severity | Mainnet gate |
|---|---|
| Critical / High | Must be `CLOSED` before restricted mainnet (WP-105) |
| Medium | Prefer closed; defer only with explicit tracking |
| Low / Informational | Track |
| Residual | Known gaps — not external-audit Criticals |

Full taxonomy + lifecycle: `docs/WP-104_AUDIT_REMEDIATION.md`.

---

## Independent verification (summary)

Code fix ≠ closed. Before `CLOSED`:

1. Root cause documented  
2. `fix_refs` present  
3. Regression coverage where testable  
4. Layer suites recorded (forge / chaos / watchtower / verify / reconcile as applicable)  
5. **Independent** verifier named (not only the fixer)  
6. Evidence dated in the register  

---

## Integrity tooling

| Tool | Doc | Command |
|---|---|---|
| Chaos (WP-101) | `docs/WP-101_CHAOS_SUITE.md` | `pnpm test:chaos` |
| Watchtower (WP-095) | `docs/WP-095_WATCHTOWER.md` | `pnpm watchtower` |
| Verify Game (WP-090) | `docs/WP-090_VERIFY_GAME.md` | public `/verify` + API |
| Reconcile (WP-083) | `docs/WP-083_RECONCILIATION_WORKER.md` | reconciliation worker |

---

## Summary board

| ID | Severity | Status | Stream | Title |
|---|---|---|---|---|
| MOZ-TPL-001 | — | `TEMPLATE` | — | Empty template row (copy to file) |
| MOZ-EX-001 | Informational | `CLOSED` | process | Register integrity check missing (scaffold example) |
| MOZ-RES-100-01 | Residual | `OPEN` | engine-replay | WP-100 GAP: ranked match / find-match API not in default E2E |
| MOZ-RES-100-02 | Residual | `OPEN` | contracts-custody | WP-100 GAP: `sealAndFundSession` atomic path not exercised |
| MOZ-RES-100-03 | Residual | `OPEN` | engine-replay | WP-100 GAP: AI hands / continuous cognition not wired in E2E |
| MOZ-RES-054-01 | Residual | `DEFERRED` | randomness-dealer | Live AWS Nitro enclave cutover (mock attestation scaffold only) |
| MOZ-RES-102-01 | Residual | `DEFERRED` | process | Base Sepolia live protocol deploy / Stage A blocked on ops |

---

## Template (copy for new findings)

```markdown
### MOZ-XXX-000 — <short title>

| Field | Value |
|---|---|
| **Severity** | Critical / High / Medium / Low / Informational / Residual |
| **Status** | OPEN |
| **Stream** | contracts-custody / randomness-dealer / engine-replay / wallet-auth / backend-admin / process / cross-cutting |
| **Source** | internal-review / stage-c / chaos / watchtower / reconcile / verify / residual-gap / external-audit |
| **Owner** | |
| **Report ref** | (required if source=external-audit) |

**Description:**

**Impact:**

**Reproduction / evidence:**

**Fix refs:** (PR, commit, paths — required from FIXED_PENDING_VERIFY)

**Verification:** (required for CLOSED)

- Verifier:
- Date:
- Commands / evidence:
- Checklist: root cause · fix · tests · suite · independent re-verify

**Sign-off:** (required for ACCEPTED_RISK / WONT_FIX)
```

Also add the same `id` to `register.yaml`, then run `pnpm audit:register-check`.

---

## Example closed finding (scaffold — not a paid audit)

### MOZ-EX-001 — Audit remediation register lacked machine-checkable integrity gate

| Field | Value |
|---|---|
| **Severity** | Informational |
| **Status** | `CLOSED` |
| **Stream** | process |
| **Source** | `wp-104-scaffold-example` |
| **Owner** | WP-104 agent |
| **Report ref** | n/a — scaffold example |

**Description:**  
Before WP-104, there was no durable findings register with severity taxonomy, CLOSED evidence rules, or CI validation. Remediation could not be tracked to independently verified closure.

**Impact:**  
Process/documentation only — no protocol fund-flow defect.

**Reproduction / evidence:**  
Absence of `docs/audits/` prior to this packet.

**Fix refs:**

- `docs/WP-104_AUDIT_REMEDIATION.md`
- `docs/audits/FINDINGS.md`
- `docs/audits/register.yaml`
- `scripts/audits/check-register.mjs`
- `pnpm audit:register-check`

**Verification:**

- Verifier: WP-104 scaffold (register check automation — independent of finding author narrative)
- Date: 2026-08-07
- Commands / evidence: `pnpm audit:register-check` → exit 0; CLOSED rows require verifier + evidence fields
- Checklist: root cause · fix · tests (schema check) · suite · independent re-verify via CI hook

---

## Residual items (documented gaps — not invented Criticals)

### MOZ-RES-100-01 — WP-100 GAP: ranked match / find-match API not in default E2E

| Field | Value |
|---|---|
| **Severity** | Residual |
| **Status** | `OPEN` |
| **Stream** | engine-replay |
| **Source** | `wp-100-gap` |
| **Owner** | unassigned |
| **Report ref** | `docs/WP-100_ANVIL_E2E.md` § Documented gaps |

**Description:**  
Default `pnpm e2e:protocol-v3:redeploy` uses on-chain relayer `openSession` tickets. Ranked match / find-match API path requires `--with-api` when API + game server are healthy.

**Impact:**  
E2E coverage gap; not a claimed external-audit Critical.

**Follow-up:** Wire `--with-api` into long-lived CI fixtures when stack is available.

---

### MOZ-RES-100-02 — WP-100 GAP: `sealAndFundSession` atomic path not exercised

| Field | Value |
|---|---|
| **Severity** | Residual |
| **Status** | `OPEN` |
| **Stream** | contracts-custody |
| **Source** | `wp-100-gap` |
| **Owner** | unassigned |
| **Report ref** | `docs/WP-100_ANVIL_E2E.md`; WP-041 |

**Description:**  
E2E seals via `SessionLifecycleV2` draft→seal stubs alongside vault `openSession`, not the atomic V3 `sealAndFundSession` submit path from `@mozetto/session-seal`.

**Impact:**  
Integration coverage gap for WP-041 coordinator submit path.

**Follow-up:** Optional E2E stage submitting via `SessionSealCoordinator` → `sealAndFundSession`.

---

### MOZ-RES-100-03 — WP-100 GAP: AI hands / continuous cognition not wired in E2E

| Field | Value |
|---|---|
| **Severity** | Residual |
| **Status** | `OPEN` |
| **Stream** | engine-replay |
| **Source** | `wp-100-gap` |
| **Owner** | unassigned |
| **Report ref** | `docs/WP-100_ANVIL_E2E.md` |

**Description:**  
AI-only hands / continuous cognition not end-to-end in the Anvil protocol orchestrator. Settlement uses stub event/hand/balance roots, not a 100+ hand replay.

**Impact:**  
Cannot yet claim full AI-session Anvil lifecycle; Phase 9 exit recorded as `PASS_WITH_GAPS`.

**Follow-up:** Replace stub roots with event-store / root-builder output after settlement cutover; compose live game-server + agent-runtime + dealer.

---

### MOZ-RES-054-01 — Live AWS Nitro enclave cutover deferred

| Field | Value |
|---|---|
| **Severity** | Residual |
| **Status** | `DEFERRED` |
| **Stream** | randomness-dealer |
| **Source** | `residual-gap` |
| **Owner** | ops |
| **Report ref** | `docs/WP-054_NITRO_ENCLAVE_DEALER.md` |

**Description:**  
WP-054 delivered mock attestation / enclave scaffold. Production TEE requires live AWS Nitro host, vsock parent, and published measurements.

**Impact:**  
Dealer trust model remains “attested confidential dealer” scaffold until live Nitro; product language must not claim fully trustless mental poker.

**Sign-off / deferral:** Deferred to ops Nitro cutover; tracked for mainnet readiness (Plan 14 dealer/randomness review).

---

### MOZ-RES-102-01 — Base Sepolia live protocol deploy / Stage A blocked

| Field | Value |
|---|---|
| **Severity** | Residual |
| **Status** | `DEFERRED` |
| **Stream** | process |
| **Source** | `residual-gap` |
| **Owner** | ops |
| **Report ref** | `docs/WP-102_SEPOLIA_DEPLOYMENT.md`, `docs/WP-103_PUBLIC_TESTNET_PROGRAM.md` |

**Description:**  
Sepolia recipes ready; `baseSepolia.json` protocol addresses remain null until funded deployer broadcasts. Stage A/B/C adversarial program cannot feed live findings until then.

**Impact:**  
Blocks live Stage C inputs into this register; does not invent addresses or claim network live.

**Follow-up:** Ops `pnpm sepolia:deploy` → verify → VRF adapter → attestors → Stage A checklist → eventually Stage C → file real findings here.

---

## Empty slots (ready to file)

When Stage C or an external audit produces a finding, replace a slot or append. Keep `register.yaml` in sync.

| ID | Severity | Status | Notes |
|---|---|---|---|
| _(none reserved)_ | | `TEMPLATE` | Copy MOZ-TPL-001; assign next `MOZ-AUD-NNN` or stream-prefixed id |

Suggested id prefixes:

| Prefix | Use |
|---|---|
| `MOZ-AUD-` | External audit finding |
| `MOZ-C-` | Stage C adversarial |
| `MOZ-INT-` | Internal review |
| `MOZ-RES-` | Residual / documented gap |
| `MOZ-EX-` | Examples / process demos |
