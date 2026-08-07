# WP-105 — Restricted Base Mainnet human checklist

**Authority:** `docs/WP-105_RESTRICTED_MAINNET.md`, Plan 14 mainnet readiness gate  
**Rule:** Do **not** broadcast until `pnpm mainnet:gate` is green **and** `finalGateApproval` is explicitly true. Do not invent addresses.

---

## Entry gates (all required)

- [ ] **WP-104** critical/high findings closed and independently verified (`GATES.json` → `wp104CriticalsClosed`)
- [ ] **WP-103 Stage C** complete (adversarial program exit metrics met) (`stageCComplete`)
- [ ] Bytecode matches audited commit (`bytecodeMatchesAuditedCommit`)
- [ ] Protocol Safe (3-of-5) + Treasury Safe live; timelock/minDelay posture live (`safeTimelockLive`) — see `docs/WP-093_SAFE_TIMELOCK.md`
- [ ] Key separation verified (deployer ≠ attestors ≠ treasury ≠ guardian)
- [ ] Independent attestors operational (production 3-of-N+, distinct KMS/HSM keys)
- [ ] Production RPC redundancy (primary + independent fallback)
- [ ] Production Groq capacity / limits understood
- [ ] Public Verify Game + watchtower path complete against production posture
- [ ] Emergency exit tested on staging / Sepolia with production-like keys
- [ ] Reconciliation auto-pause proven on hosted stack
- [ ] Incident drills complete
- [ ] Legal / compliance launch decision complete
- [ ] Responsible-play + account-security controls ready
- [ ] Bug bounty active
- [ ] Restricted caps configured (buy-in, concurrency, region)
- [ ] Allowlist configured (limited users)
- [ ] **`finalGateApproval`** flipped only after all of the above

Flip corresponding keys in `scripts/mainnet/GATES.json` only with evidence links in ops log.

---

## Restricted launch posture (Plan 14)

- [ ] One NLHE template only
- [ ] One standardized Groq model policy
- [ ] Low buy-in cap (numeric threshold documented before go-live)
- [ ] Limited / allowlisted users
- [ ] Strict max concurrent sealed sessions
- [ ] Frequent checkpoints + enhanced manual monitoring
- [ ] No house games
- [ ] No Open AI league

---

## Deploy recipe (after gates green)

1. [ ] `pnpm mainnet:gate` → exit 0
2. [ ] `pnpm mainnet:check` → env + chain id 8453; not Anvil #0
3. [ ] `USE_MOCK_USDC` unset / `0`
4. [ ] Cutover `DeployMainnet.s.sol` from `DeploySepolia` pattern reviewed
5. [ ] `MOZETTO_MAINNET_FINAL_GATE_APPROVED=1` set in ops secret store only
6. [ ] Live broadcast + `WRITE_CHAIN_MANIFEST=1` → fill `packages/chain-manifest/deployments/base.json`
7. [ ] `pnpm manifest:codegen` committed
8. [ ] Basescan verify; Chainlink VRF adapter; merge adapter address
9. [ ] Hosted stack on mainnet manifest; smoke allowlisted custody path
10. [ ] `pnpm mainnet:gate deployed` → exit 0

Until steps 1–5 are true, `scripts/mainnet/deploy.sh broadcast` **must refuse**.
