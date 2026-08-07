# WP-105 — Restricted Base Mainnet deployment (recipes & gates)

**Authority:** Plan 14 mainnet readiness + restricted launch (`14_ANVIL_SEPOLIA_MAINNET_TEST_AND_AUDIT_PLAN.md`), Plan 17 DoD, WP-105 in `16_AGENT_WORK_PACKETS.md` (“Only after final gate approval”)  
**Prior:** WP-102 Sepolia recipes (`docs/WP-102_SEPOLIA_DEPLOYMENT.md`), WP-103 Stage A→C (`docs/WP-103_PUBLIC_TESTNET_PROGRAM.md`), WP-104 audit remediation, WP-093 Safe/timelock  
**Date:** 2026-08-07

---

## Status

**Recipes / gates DONE. Live restricted mainnet = BLOCKED pending approvals.**

| Item | State |
|---|---|
| Entry gate definition (Plan 14) | This doc + `scripts/mainnet/GATES.json` |
| Ops scripts / checklists | `scripts/mainnet/` |
| `base.json` protocol addresses | **Honest nulls** — do not invent |
| `DeployMainnet.s.sol` | Guarded stub (always reverts; no broadcast path) |
| Live Base mainnet (`8453`) deploy | **BLOCKED** until all gates + `finalGateApproval` |
| Final gate | Explicitly **false** until audits + Stage C + remaining Plan 14 items |

Do **not** broadcast mainnet transactions from this packet. Do **not** invent protocol addresses. Do **not** treat Anvil default keys as mainnet truth.

---

## Entry gates (must all be true)

From Plan 14 **Mainnet readiness gate**, plus WP-105 restricted posture:

| Gate key (`GATES.json`) | Meaning |
|---|---|
| `wp104CriticalsClosed` | WP-104 critical/high findings closed & independently verified |
| `stageCComplete` | WP-103 Stage C (adversarial) exit criteria met |
| `bytecodeMatchesAuditedCommit` | Deploy bytecode matches audited commit |
| `safeTimelockLive` | Protocol Safe + Treasury Safe (+ timelock/minDelay) live — WP-093 |
| `keySeparationVerified` | Deployer / attestors / treasury / guardian separated |
| `independentAttestorsOperational` | Production attestor quorum operational |
| `productionRpcRedundancy` | Paid primary RPC + independent fallback |
| `productionGroqCapacityUnderstood` | Capacity / limits agreement understood |
| `publicVerificationComplete` | Public Verify Game path production-ready |
| `emergencyExitTested` | Emergency exit exercised |
| `reconciliationAutomatic` | Reconciliation + auto-pause proven |
| `incidentDrillsComplete` | Incident drills complete |
| `legalComplianceLaunchDecision` | Legal / compliance go decision |
| `responsiblePlayControlsReady` | Responsible-play + account security |
| `bugBountyActive` | Bug bounty active |
| `restrictedCapsConfigured` | Low buy-in + concurrency caps set |
| `allowlistConfigured` | Limited / allowlisted users |
| `finalGateApproval` | **Explicit last switch** — only after all others |

Gate helper (fails honestly while any required gate is false):

```bash
pnpm mainnet:gate
```

---

## Restricted launch posture (Plan 14)

Start with:

- one NLHE template;
- one standardized Groq model policy;
- low buy-in cap;
- limited / allowlisted users;
- one active region if necessary;
- strict max concurrent sessions;
- frequent checkpoints;
- enhanced manual monitoring;
- **no** house games;
- **no** Open AI league.

Numeric thresholds for caps and expansion metrics must be defined **before** go-live (Plan 14 expansion metrics).

---

## Delivered

| Item | Location |
|---|---|
| This note | `docs/WP-105_RESTRICTED_MAINNET.md` |
| Gate status file | `scripts/mainnet/GATES.json` (all required = `false`) |
| Gate runner | `scripts/mainnet/gate.sh` → `pnpm mainnet:gate` |
| Manifest null-check | `scripts/mainnet/check-manifest.mjs` → `pnpm mainnet:check-manifest` |
| Gate JSON reader | `scripts/mainnet/check-gates.mjs` |
| Deploy wrapper (refuses broadcast) | `scripts/mainnet/deploy.sh` → `pnpm mainnet:check\|dry-run\|deploy` |
| Human checklist | `scripts/mainnet/RESTRICTED_MAINNET_CHECKLIST.md` |
| Mainnet manifest slot | `packages/chain-manifest/deployments/base.json` |
| Codegen path | `pnpm manifest:codegen` / `pnpm --filter @mozetto/chain-manifest codegen` |
| Deploy stub + guards | `contracts/script/DeployMainnet.s.sol` |

Does **not** mutate frozen `/specs`, does **not** broadcast mainnet txs, does **not** commit private keys or fake addresses.

---

## Manifest schema (mainnet slot)

`packages/chain-manifest/deployments/base.json`:

| Field | Pre-live | Post-broadcast (future) |
|---|---|---|
| `chainId` | `8453` | same |
| `usdc` / `symbol` | Circle Base USDC / `USDC` | same |
| `isTestAsset` / `faucetEnabled` | **false** (enforced) | false |
| Protocol addresses | `null` | hex from live deploy |
| `chainlinkVrfAdapter` | `null` until adapter deploy | hex |
| `vrfCoordinator` / `vrfKeyHash` | Chainlink Base mainnet constants | same |
| `protocolVersion` | `2.0.0-mainnet-restricted` | same |
| `deploymentBlock` | `0` | on-chain block |

Codegen ignores undocumented `_status` / `_note` bookkeeping keys. MockUSDC is **forbidden** on `base` (codegen + runtime guard).

### Manifest commands

```bash
# Pre-broadcast honesty: protocol fields must remain null
pnpm mainnet:check-manifest -- --honesty

# Post-broadcast (future): fail while nulls remain
pnpm mainnet:check-manifest

# Regenerate TS after real fills only
pnpm manifest:codegen
```

---

## Env checklist (names only)

### Required for any future live broadcast

| Name | Purpose |
|---|---|
| `PRIVATE_KEY` | Ops deployer EOA (funded Base ETH; **not** Anvil #0) |
| `BASE_RPC_URL` | Base mainnet RPC (`8453`) |
| `MOZETTO_MAINNET_FINAL_GATE_APPROVED` | Must be `1` — only after Plan 14 + `finalGateApproval` |

### Strongly recommended / go-live

| Name | Purpose |
|---|---|
| `BASESCAN_API_KEY` | Basescan verify |
| `FEE_TREASURY_ADDRESS` | Ultimate fee recipient (Treasury Safe) |
| `PROTOCOL_SAFE_ADDRESS` | Protocol Safe (3-of-5 target) |
| `TREASURY_SAFE_ADDRESS` | Receive-only Treasury Safe |
| `TIMELOCK_CONTROLLER_ADDRESS` | Optional OZ TimelockController |
| `ATTESTOR_1/2/3_ADDRESS` (+ more) | Distinct production attestors |
| `ATTESTOR_MIN_SIGNATURES` | Production quorum (≥ 3) |

### Restricted posture / product caps

| Name | Purpose |
|---|---|
| `MAINNET_ALLOWLIST_ENABLED` | Enforce allowlist |
| `MAINNET_MAX_BUY_IN_USDC` | Low buy-in cap |
| `MAINNET_MAX_CONCURRENT_SESSIONS` | Strict concurrency |

### Deploy posture (forbidden / gated)

| Name | Note |
|---|---|
| `USE_MOCK_USDC` | **Must be `0` / unset** — stub + shell refuse `1` |
| `ENABLE_MOCK_VRF` | **Must be `0`** on mainnet |
| `WRITE_CHAIN_MANIFEST` | Only after real approved broadcast (not enabled in WP-105 stub) |
| `SETTLEMENT_HUB_V3_AS_PRIMARY` | Cutover policy — document before go-live |
| `PROTOCOL_FEE_VAULT_MIN_DELAY` / `PROOF_BATCH_REGISTRY_MIN_DELAY` / `GAME_REGISTRY_MIN_DELAY` | Production delays (not staging `0`) |

Prefer `@mozetto/chain-manifest` over scattering addresses after fill.

---

## Commands

```bash
# 1) Plan 14 gates + honest null manifest (expected FAIL today)
pnpm mainnet:gate

# 2) Env + gate check (refuses broadcast)
pnpm mainnet:check

# 3) Compile stub / dry-run path (still refuses live tx)
pnpm mainnet:dry-run

# 4) Broadcast — hard-refused until gates + approval + stub cutover
pnpm mainnet:deploy

# 5) Codegen (keeps null protocol addresses until live fill)
pnpm manifest:codegen
```

---

## DeployMainnet stub vs DeploySepolia reuse

| | Sepolia (WP-102) | Mainnet (WP-105) |
|---|---|---|
| Script | `DeploySepolia.s.sol` | `DeployMainnet.s.sol` **stub** |
| USDC | Circle Sepolia (or labelled mock) | Circle Base only |
| Mock VRF | Off by default | Forbidden |
| Manifest | `baseSepolia.json` | `base.json` |
| Broadcast wrapper | `pnpm sepolia:deploy` when funded | `pnpm mainnet:deploy` **refuses** until gates |

**Cutover recipe (after final approval):** port the V3 stack from `DeploySepolia.s.sol` into `DeployMainnet.s.sol` (or shared library) with mainnet constants, production minDelays, Hub V3 primary policy, attestor quorum ≥ 3, `WRITE_CHAIN_MANIFEST` only under `--broadcast`, then wire `scripts/mainnet/deploy.sh broadcast` the same way as Sepolia. Until that cutover, the stub **always reverts** even if env approval is set.

Chainlink adapter remains separate (`DeployChainlinkVrfAdapter.s.sol` / WP-053) after core deploy + funded VRF subscription on Base.

---

## Relationship to WP-102 / WP-103 / WP-104

```text
WP-102 recipes ──(ops)──► WP-103 Stage A → B → C
                                      │
                                      ▼
                               WP-104 remediation
                                      │
                                      ▼
                    WP-105 gates (this packet) ──(final approval)──► live restricted mainnet
```

WP-103 never authorizes mainnet. WP-105 recipes never authorize broadcast without `finalGateApproval`.

---

## Acceptance evidence (this packet)

```text
docs/WP-105_RESTRICTED_MAINNET.md
scripts/mainnet/GATES.json                    # all required=false; finalGateApproval=false
scripts/mainnet/{gate.sh,check-gates.mjs,check-manifest.mjs,deploy.sh}
scripts/mainnet/RESTRICTED_MAINNET_CHECKLIST.md
packages/chain-manifest/deployments/base.json # honest nulls
contracts/script/DeployMainnet.s.sol          # guarded stub
pnpm mainnet:gate        → FAIL (gates unsatisfied)
pnpm mainnet:check-manifest -- --honesty → PASS (nulls)
pnpm mainnet:deploy      → REFUSE broadcast
pnpm manifest:codegen    → base protocol addresses remain null
```

---

## Security notes

- Never commit `PRIVATE_KEY`, attestor keys, or `.env.local`.
- Never use Anvil default keys on Base mainnet.
- Never invent `base.json` protocol addresses.
- `finalGateApproval` and `MOZETTO_MAINNET_FINAL_GATE_APPROVED` are independent human controls — both required before any future live path.
- MockUSDC / faucet / test-asset flags are forbidden on chain id `8453`.

---

## Out of scope / forbidden (this packet)

- Spec mutations
- Mainnet transaction broadcast
- Fake or placeholder protocol addresses
- Claiming restricted mainnet is live
- Anvil keys as mainnet truth
- Flipping `finalGateApproval` without audits + Stage C + Plan 14 evidence

---

## Follow-up

1. Complete WP-103 Stage C and WP-104 critical/high closure with evidence.
2. Publish production Safe / timelock addresses (WP-093) into ops config (not invented here).
3. Flip `GATES.json` keys only with verified evidence; leave `finalGateApproval` for last.
4. Cut over `DeployMainnet` from `DeploySepolia` V3 pattern; then ops-approved broadcast + codegen.
5. Enforce allowlist + caps; run expansion metrics before raising limits.
