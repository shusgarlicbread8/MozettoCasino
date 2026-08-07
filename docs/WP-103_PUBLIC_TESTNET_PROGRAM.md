# WP-103 — Public testnet program (invited → adversarial)

**Authority:** Plan 14 Sepolia program (`14_ANVIL_SEPOLIA_MAINNET_TEST_AND_AUDIT_PLAN.md`), WP-103 in `16_AGENT_WORK_PACKETS.md`  
**Prior:** WP-102 Sepolia recipes (`docs/WP-102_SEPOLIA_DEPLOYMENT.md`) — **recipes DONE; live broadcast pending ops**  
**Next:** WP-104 audit remediation → WP-105 restricted mainnet gates  
**Date:** 2026-08-07

---

## Status

**Program scaffold DONE. Live Stage A is blocked on ops deploy.**

| Item | State |
|---|---|
| Stage A/B/C program definition | This doc |
| Ops scripts / checklists | `scripts/testnet/` |
| `baseSepolia.json` protocol addresses | **Honest nulls** until `pnpm sepolia:deploy` |
| Live Base Sepolia network | **Not live** — do not claim otherwise |
| Invited / adversarial testers | Not started (requires Stage A green) |

Do **not** invent deployed addresses, use Anvil default keys as production truth, or treat this packet as a live network launch.

---

## Honest blockers (Stage A entry)

From WP-102 exit criteria — **all required before team-only Stage A**:

1. **Live deploy** — funded ops deployer runs `pnpm sepolia:deploy` (`WRITE_CHAIN_MANIFEST=1` + broadcast).
2. **Manifest filled** — `packages/chain-manifest/deployments/baseSepolia.json` non-null V3 addresses + `pnpm manifest:codegen` committed.
3. **Basescan verification** — core contracts verified (or documented retry).
4. **VRF subscription** — Chainlink VRF adapter deployed, consumer added, `chainlinkVrfAdapter` merged (`pnpm` / `scripts/sepolia-merge-vrf-adapter.mjs`).
5. **Attestor 3-of-N** — distinct staging keys; `ATTESTOR_MIN_SIGNATURES` raised toward `3` (not Anvil defaults).
6. **Funded accounts** — team wallets with Base Sepolia ETH + labelled test USDC / mUSDC for custody smoke.
7. **Hosted stack** — dealer / replay / indexer / worker / API pointed at Sepolia manifest; staging Supabase migrations applied; environment labelled **testnet**.
8. **Smoke path** — fund → lock → settle → withdraw on test assets; Verify Game + indexer reindex from `deploymentBlock`.

Gate helper (fails honestly while addresses are null):

```bash
pnpm testnet:stage-a-gate
```

---

## Program shape (Plan 14)

Run **weeks, not hours**. Stages are sequential gates, not parallel marketing launches.

```text
WP-102 recipes ──(ops live tx)──► Stage A (team-only)
                                      │
                                      ▼
                                 Stage B (invited)
                                      │
                                      ▼
                                 Stage C (adversarial)
                                      │
                                      ▼
                         WP-104 audits / remediation
                                      │
                                      ▼
                         WP-105 restricted mainnet gates
```

---

## Stage A — team-only

### Purpose

Controlled wallets exercise full custody and settlement on Base Sepolia with **no external users**. Prove reindex, Verify Game, and pause paths before inviting anyone.

### Entry criteria

- [ ] All honest blockers above green (`pnpm testnet:stage-a-gate` exit 0)
- [ ] Public UI / API labelled **testnet** (no mainnet copy, no real-value promises)
- [ ] Distinct staging keys for deployer, attestors, fee treasury (not Anvil #0…#9)
- [ ] Admin RBAC + audit log available for ops actions (`docs/WP-094_AUDIT_RBAC.md`)
- [ ] Pause / governance runbooks reviewed (`scripts/testnet/PAUSE_RUNBOOK.md`)

### Caps (Stage A)

| Cap | Value |
|---|---|
| External users | **0** (team wallets only) |
| Concurrent sealed sessions | ≤ 4 |
| Buy-in | Low test-asset only (mUSDC or labelled Circle USDC faucet) |
| Templates | One NLHE HU + optional six-max smoke |
| Attestor quorum | ≥ 3-of-N with distinct keys |
| Matchmaking | Team-scheduled or allowlisted intents only |
| Rewards / bounty | None |

### Required exercises

1. Full custody path: fund ArenaAccount → permission → lock → seal → play → settle → withdraw.
2. Indexer cold reindex from `deploymentBlock`; solvency dashboard clean (`docs/WP-091_ADMIN_SOLVENCY_DASHBOARD.md`).
3. Public Verify Game for a completed session (`/verify`, `docs/WP-090_VERIFY_GAME.md`).
4. Offline + package watchtower pass (`pnpm watchtower`; optional live registry when batches exist).
5. Pause drill: vault pause / matchmaking pause → no new locks → unpause (see runbook).
6. One chaos subset against hosted staging (`pnpm test:chaos` unit; live only if safe).

### Exit criteria → Stage B

- [ ] ≥ 7 consecutive calendar days without critical solvency / double-pay / settlement forgery incidents
- [ ] Zero unexplained vault discrepancies in rolling window
- [ ] Reindex + Verify Game smoke documented
- [ ] Pause drill completed and recorded in ops log
- [ ] Incident channel + severity definitions agreed

---

## Stage B — invited testers

### Purpose

Bounded external testers on mUSDC / test USDC with public Verify Game and fault reporting. Still **not** an open adversarial network.

### Entry criteria

- [ ] Stage A exit criteria met
- [ ] Written invite list + NDAs / terms as required by legal
- [ ] Soft caps configured in matchmaker / registry (see below)
- [ ] Fault intake channel live (GitHub issues template or equivalent)
- [ ] Testnet faucet policy documented (rate-limited; no real-value redemption)

### Caps (Stage B)

| Cap | Value |
|---|---|
| Invited accounts | ≤ 50 (raise only after 14-day clean window) |
| Concurrent sealed sessions | ≤ 16 |
| Max buy-in (test asset) | Ops-defined low cap (document in invite) |
| Templates | NLHE only; no house games; no Open AI league |
| Concurrent AI sessions | Ops capacity agreement with Groq staging limits |
| Public rewards | Optional small **test-asset** incentives only; no cash claims |

### Required exercises

1. Invited players complete ≥ 1 full settle + withdraw each (sample).
2. Public Verify Game used by at least one non-ops tester.
3. Fault reports triaged within SLA (P0 same day, P1 ≤ 2 business days).
4. Watchtower / CLI pointers published in invite pack (`scripts/testnet/verify-cli-hints.sh`).

### Exit criteria → Stage C

- [ ] ≥ 14 days invited traffic with zero critical custody/settlement incidents
- [ ] Dispute / fault rate within ops threshold (define before open; suggest ≤ 2% sessions disputed)
- [ ] Settlement success rate and p99 settlement age within pre-agreed thresholds
- [ ] Game-state divergence count = **0**
- [ ] Legal OK for public adversarial labelling

---

## Stage C — adversarial public testnet

### Purpose

Public test rewards, open verifier / watchtower consumers, **intentionally documented attack surface**, **no real-value promises**. Adversaries are expected; protocol must stay safe.

### Entry criteria

- [ ] Stage B exit criteria met
- [ ] Published attack-surface note (what is in / out of scope for rewards)
- [ ] Bug-bounty / test-reward rules frozen (test assets or points only)
- [ ] Open watchtower docs + Verify Game URLs
- [ ] Emergency pause owners on-call rotation

### Caps (Stage C)

| Cap | Value |
|---|---|
| Users | Public (rate-limited faucet / invite-optional boost) |
| Concurrent sealed sessions | ≤ 64 (raise only on metrics) |
| Buy-in | Still **test assets only** |
| House games / Open AI league | **Forbidden** |
| Mainnet bridging / real USDC redemption | **Forbidden** |
| Duration | Weeks minimum before WP-105 consideration |

### Documented attack surface (in scope for reporting)

Aligned with Plan 14 security mutations — examples:

- SeatTicket replay, over-cap GamePermission, substitute ArenaAccount
- Participant-root / VRF / deck / card mutations
- Event reorder, excessive rake, payout redirect, duplicate settlement
- Fake / duplicate signers, stale deadline, emergency-exit replay
- Indexer lag spoofing, proof-batch gaps, Verify Game category misuse

Out of scope for rewards (still report): social engineering of ops keys, DoS against third-party RPC, phishing.

### Exit criteria → audits / mainnet path

- [ ] Adversarial window completed (ops-defined weeks)
- [ ] Critical/high findings filed into **WP-104** remediation tracker
- [ ] Expansion metrics thresholds defined numerically (below) and met in rolling window
- [ ] No open critical solvency or double-pay issues
- [ ] Ready to commission multi-stream audits (Plan 14) and then **WP-105** gates

---

## Success metrics (define numbers before raising caps)

Plan 14: raise caps only if the rolling window meets thresholds. **Set numeric values before Stage B open**; do not invent soft targets after weak results.

| Metric | Direction | Suggested Stage B floor (ops to freeze) |
|---|---|---|
| Solvency discrepancies | = 0 unexplained | 0 |
| Settlement success rate | High | ≥ 99% of eligible settles |
| p99 settlement age | Low | Ops freeze (e.g. ≤ 30 min staging) |
| Game-state divergence | = 0 | 0 |
| Dealer attestation success | High | ≥ 99% |
| AI fallback rate | Bounded | Ops freeze vs Groq staging |
| Uptime (API/game) | High | ≥ 99% excluding planned pauses |
| Dispute rate | Low | ≤ 2% sessions |
| Security incident severity | No open critical | P0 closed or paused |
| Watchtower verification rate | High on published packages | ≥ 95% `VERIFIED*` when data complete |

---

## Incident response

### Severity

| Level | Examples | Response |
|---|---|---|
| **P0** | Vault insolvency signal, double-pay, forged settlement, key compromise | Immediate pause new sessions + vault pause if needed; war room; public testnet status note |
| **P1** | Settlement stall cluster, VRF outage, attestor quorum loss, Verify Game false `VERIFIED` | Pause matchmaking; fix forward; no Stage promotion |
| **P2** | Single-session stuck, indexer lag, AI fallback spike | Ticket; monitor; no invite expansion |
| **P3** | UX / docs / faucet friction | Backlog |

### First 15 minutes (P0/P1)

1. Acknowledge in ops channel; assign incident lead.
2. Freeze new matchmaking / seals (admin + registry as applicable).
3. If funds-at-risk: execute vault pause per `scripts/testnet/PAUSE_RUNBOOK.md`.
4. Snapshot: session IDs, tx hashes, solvency dashboard, latest proof batch, attestor set.
5. Do **not** rotate keys in panic without dual control; do **not** reuse Anvil keys.

### Communications

- Stage A: internal only.
- Stage B/C: status page or pinned issue within 1 hour for P0; no “funds are safe” claims without reconciliation evidence.

### Post-incident

- Blameless write-up → WP-104 tracker if protocol/security related.
- Stage demotion allowed (C→B or B→A) until exit criteria re-met.

---

## Pause runbooks (summary)

Full steps: [`scripts/testnet/PAUSE_RUNBOOK.md`](../scripts/testnet/PAUSE_RUNBOOK.md).

| Layer | Action | Tooling |
|---|---|---|
| Matchmaking / new sessions | Disable intents / pause_after_hand | Admin ops + reconciliation auto-pause (`WP-083`, `WP-094`) |
| ArenaVault | `pause` / `unpause` | Governance CLI / Safe (`docs/WP-093_SAFE_TIMELOCK.md`) |
| Game templates | Deactivate template | GameRegistryV2 schedule/execute |
| Full freeze | Vault pause + matchmaking off + status note | Combined |

Unpause only after solvency check green and incident lead sign-off.

---

## Ops scripts

| Script / command | Role |
|---|---|
| `pnpm testnet:stage-a-gate` | Manifest non-null + env hints; **fails while addresses null** |
| `pnpm testnet:health` | HTTP health against hosted URLs (env) |
| `pnpm testnet:verify-hints` | Print Verify Game + watchtower + randomness CLI pointers |
| `scripts/testnet/STAGE_A_CHECKLIST.md` | Human checklist once manifest is filled |
| `scripts/testnet/PAUSE_RUNBOOK.md` | Pause / unpause steps |

These do **not** broadcast transactions or invent addresses.

---

## Relationship to WP-104 / WP-105

| Packet | Role after this program |
|---|---|
| **WP-104 Audit remediation** | Track findings (internal + external multi-stream audits) to independently verified closure. Register: `docs/WP-104_AUDIT_REMEDIATION.md` + `docs/audits/` (`pnpm audit:register-check`). Stage C outputs feed this tracker; critical/high must close before mainnet. |
| **WP-105 Restricted mainnet deployment** | Only after Plan 14 mainnet readiness gate: audits closed, bytecode match, Safe/timelock, attestors, RPC redundancy, emergency exit tested, legal/compliance, bug bounty active, **low caps**. This WP-103 program never authorizes mainnet. |

Restricted mainnet start posture (Plan 14 reminder): one NLHE template, one Groq policy, low buy-in, limited users, strict concurrency, no house games, no Open AI league.

---

## Acceptance evidence (this packet)

```text
docs/WP-103_PUBLIC_TESTNET_PROGRAM.md          # Stages A/B/C + metrics + IR
scripts/testnet/STAGE_A_CHECKLIST.md
scripts/testnet/PAUSE_RUNBOOK.md
scripts/testnet/check-manifest.mjs             # honest null → exit 1
scripts/testnet/stage-a-gate.sh
scripts/testnet/health-check.sh
scripts/testnet/verify-cli-hints.sh
pnpm testnet:stage-a-gate → FAIL while baseSepolia protocol addresses are null
```

---

## Out of scope / forbidden

- Spec mutations
- Inventing or committing fake Sepolia protocol addresses
- Claiming the public testnet is live
- Mainnet (`8453`) deploy
- Anvil default keys as staging/production truth
- Real-value promises or redemption from test assets

---

## Follow-up

1. Ops: fund deployer → `pnpm sepolia:deploy` → verify → VRF adapter → 3-of-N attestors → commit real manifest.
2. Run `pnpm testnet:stage-a-gate` until green; execute Stage A checklist.
3. Progress Stages B→C over weeks; feed findings to WP-104; only then approach WP-105 gates.
