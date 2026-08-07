# WP-104 — Audit remediation

**Authority:** `mozetto_execution_plans/14_ANVIL_SEPOLIA_MAINNET_TEST_AND_AUDIT_PLAN.md` (Audit streams + Mainnet readiness gate), `17_FINAL_DEFINITION_OF_DONE.md` (Testing/audit), `16_AGENT_WORK_PACKETS.md` WP-104, `docs/WP-103_PUBLIC_TESTNET_PROGRAM.md`  
**Date:** 2026-08-07  
**Status:** `DONE` (remediation **scaffold** + register + verification rules). External multi-stream audits and Stage C adversarial outputs are **not** claimed complete.

---

## Goal

Track audit and adversarial findings to **independently verified closure**. A code patch alone does not close a finding.

This packet scaffolds:

1. Findings register (human + machine-readable)
2. Severity taxonomy and lifecycle states
3. Independent verification checklist and evidence requirements
4. Pointers to existing integrity tooling (chaos / watchtower / verify / reconcile)
5. CI hook that validates register integrity (does not invent or fake audit reports)

---

## Delivered

| Item | Location |
|---|---|
| This note | `docs/WP-104_AUDIT_REMEDIATION.md` |
| Human findings register | `docs/audits/FINDINGS.md` |
| Machine register | `docs/audits/register.yaml` |
| Register integrity check | `scripts/audits/check-register.mjs` |
| pnpm entry | `pnpm audit:register-check` |
| CI step | `.github/workflows/ci.yml` → Audit findings register (WP-104) |

Frozen `/specs` untouched. No mainnet deploy. No claim that paid or external audits have completed.

---

## Audit streams (Plan 14)

Commission and track separately (a single general audit is not sufficient):

| Stream ID | Scope |
|---|---|
| `contracts-custody` | ArenaAccount / GamePermission / Vault / Settlement / fee vault |
| `randomness-dealer` | Randomness beacon, VRF adapters, confidential dealer, deck proofs |
| `engine-replay` | Poker engine, event/replay semantics, roots, WASM verifier |
| `wallet-auth` | Wallet / auth / session-key architecture |
| `backend-admin` | Backend / cloud / KMS / admin RBAC / ops surfaces |

Findings must set `stream` to one of the above (or `process` / `cross-cutting` for tracker/meta items).

---

## Severity taxonomy

| Severity | Meaning | Mainnet gate |
|---|---|---|
| **Critical** | Direct loss of funds, unauthorized settlement, solvency break, key/custody compromise, silent wrong results | Must be `CLOSED` (or formally `ACCEPTED_RISK` with dual sign-off — exceptional) |
| **High** | High-confidence path to the above under realistic assumptions; privilege escalation to money paths | Must be `CLOSED` before restricted mainnet |
| **Medium** | Meaningful integrity / availability / privacy impact; exploit requires uncommon conditions or limited blast radius | Prefer closed; track explicitly if deferred |
| **Low** | Defense-in-depth, UX security, hard-to-reach issues | Track; not a hard mainnet blocker alone |
| **Informational** | Notes, hardening suggestions, documentation gaps | Track optionally |
| **Residual** | Known engineering / E2E **gaps** (e.g. WP-100 `PASS_WITH_GAPS`) — **not** invented external-audit Criticals | Must not be relabeled Critical/High without a real finding write-up |

Do **not** invent Critical/High rows “as if from a paid audit.” File real findings from: internal review, Stage C reports, chaos failures, watchtower/reconcile alerts, or future external reports (attach `report_ref`).

---

## Lifecycle (code fix ≠ closed)

```text
OPEN
  → IN_PROGRESS          (owner assigned, fix underway)
  → FIXED_PENDING_VERIFY (patch + tests landed; awaiting independent re-check)
  → CLOSED               (independent verification evidence recorded)
     or ACCEPTED_RISK / WONT_FIX / DEFERRED (explicit sign-off fields required)
```

| Status | Allowed only when |
|---|---|
| `OPEN` | Finding filed with severity, stream, description, source |
| `IN_PROGRESS` | `owner` set |
| `FIXED_PENDING_VERIFY` | `fix_refs` (PR/commit/paths) present |
| `CLOSED` | Independent verification checklist satisfied; `verification` block complete |
| `ACCEPTED_RISK` | `signoff` has risk owner + rationale + expiry/review date |
| `WONT_FIX` | `signoff` rationale (not for Critical/High money bugs without dual sign-off) |
| `DEFERRED` | Linked follow-up packet/date; not used to hide Critical/High for mainnet |

---

## Independent verification checklist

A finding may move to `CLOSED` only when **all** applicable boxes are true:

1. **Root cause** documented (not only symptoms).
2. **Fix landed** on the intended branch/commit; `fix_refs` list PRs, commits, or paths.
3. **Regression tests** added or updated where the defect is testable.
4. **Suite evidence** recorded for the relevant layer(s):
   - Contracts → `forge test` (targeted + related)
   - Engine/replay → protocol vectors / engine-diff / poker-replay / WASM as applicable
   - Chaos → `pnpm test:chaos` (and live drill if the finding was live-path)
   - Public verify → Verify Game / CLI paths in WP-090
   - Watchtower → `pnpm watchtower` (or package tests) when proof/randomness/balance related
   - Solvency → reconciliation worker checks (WP-083) when custody/fees related
5. **Independent re-verify** by someone (or automation stream) **other than the primary fixer** — name/role in `verification.verifier`.
6. **No silent severity downgrade** without written rationale in the finding.
7. Register status updated to `CLOSED` with dated evidence links.

Template fields live in `docs/audits/FINDINGS.md` and `docs/audits/register.yaml`.

---

## Evidence requirements

| Field | Required for |
|---|---|
| `id` | Always (`MOZ-…` stable id) |
| `title`, `severity`, `stream`, `status`, `source` | Always |
| `description` | Always |
| `owner` | `IN_PROGRESS`+ |
| `fix_refs` | `FIXED_PENDING_VERIFY`+ |
| `verification.verifier` | `CLOSED` |
| `verification.date` | `CLOSED` |
| `verification.commands` or `verification.evidence` | `CLOSED` |
| `report_ref` | External audit / Stage C write-up sourced findings |
| `signoff` | `ACCEPTED_RISK` / `WONT_FIX` |

`source` values:

| Value | Use |
|---|---|
| `template` | Empty/example scaffold rows |
| `wp-104-scaffold-example` | Demonstrates closed lifecycle (not a paid audit) |
| `internal-review` | Team review |
| `wp-100-gap` / `residual-gap` | Documented E2E/product gaps |
| `stage-c` | Public adversarial testnet |
| `chaos` / `watchtower` / `reconcile` / `verify` | Tooling-originated |
| `external-audit` | Requires real `report_ref` (firm + report id/date) — **do not fake** |

---

## Integrity tooling pointers

Use these when filing, reproducing, or closing findings:

| Packet | Doc | Command / surface | Role in remediation |
|---|---|---|---|
| **WP-101** Chaos | `docs/WP-101_CHAOS_SUITE.md` | `pnpm test:chaos` (+ live optional) | Recovery / double-pay / lease / outbox properties |
| **WP-095** Watchtower | `docs/WP-095_WATCHTOWER.md` | `pnpm watchtower` | Independent proof-batch / balance / randomness checks |
| **WP-090** Verify Game | `docs/WP-090_VERIFY_GAME.md` | `/verify`, public verify API | Player-facing public verification |
| **WP-083** Reconcile | `docs/WP-083_RECONCILIATION_WORKER.md` | reconciliation worker / admin solvency | Vault vs liabilities; auto-pause on critical mismatch |
| **WP-100** Anvil E2E | `docs/WP-100_ANVIL_E2E.md` | `pnpm e2e:protocol-v3:redeploy` | Happy-path + honest `PASS_WITH_GAPS` residuals |
| **WP-103** Testnet program | `docs/WP-103_PUBLIC_TESTNET_PROGRAM.md` | Stage A/B/C + pause runbook | Feeds Stage C findings into this register |

---

## Mainnet readiness (Plan 14 reminder)

WP-104 tracks closure; **WP-105** is the restricted mainnet packet. Before mainnet, Plan 14 still requires (among others):

- Critical/High findings closed (this register)
- Bytecode matches audited commit
- Safe/timelock, key separation, attestors, RPC redundancy
- Public verification, emergency exit, reconciliation, incident drills
- Legal/compliance + bug bounty active

This scaffold does **not** authorize mainnet.

---

## How to file a finding

1. Copy the empty template row in `docs/audits/FINDINGS.md`.
2. Add a matching object under `findings:` in `docs/audits/register.yaml` (same `id`).
3. Set severity honestly; use `Residual` for known gaps, not inflated Critical.
4. Run `pnpm audit:register-check`.
5. Link Stage C / chaos / watchtower / reconcile evidence when applicable.

---

## CI / docs hooks

```bash
pnpm audit:register-check
# optional mainnet-oriented gate (fails on open Critical/High):
pnpm audit:register-check -- --gate-mainnet
```

CI runs the integrity check (schema + CLOSED evidence rules + anti-fake external-audit rows). It does **not** require zero open Residual gaps.

---

## Acceptance evidence (this packet)

```text
docs/WP-104_AUDIT_REMEDIATION.md
docs/audits/FINDINGS.md                 # taxonomy + template + example CLOSED + residual gaps
docs/audits/register.yaml               # machine register
scripts/audits/check-register.mjs
pnpm audit:register-check               # exit 0 on valid scaffold
CI: Audit findings register (WP-104)
No invented Critical vulns from a fictional paid audit
No /specs mutations; no mainnet deploy
```

---

## Out of scope / forbidden

- Spec mutations
- Claiming external audits completed
- Inventing fake Critical/High “auditor” findings
- Mainnet (`8453`) deploy
- Treating `FIXED_PENDING_VERIFY` as closed

---

## Follow-up

1. File Stage A/B/C and future external-audit findings into the register as they appear.
2. Close Critical/High with independent verification before WP-105.
3. Keep Residual WP-100 gaps honest until E2E wiring lands; do not relabel them as audit Criticals.
4. When a real external report exists, set `source: external-audit` + `report_ref` and track stream-by-stream.
