# Stage A checklist — team-only Base Sepolia

**Authority:** `docs/WP-103_PUBLIC_TESTNET_PROGRAM.md`  
**Ops sequence:** `docs/WAVE_13_STAGE_A_GO_LIVE.md`  
**Prerequisite:** WP-102 exit criteria (live deploy + filled manifest). Do not tick boxes against invented addresses.

Use this only after `pnpm testnet:stage-a-gate` exits **0**.

---

## Pre-flight

- [ ] `pnpm sepolia:check` — funded **non-Anvil** ops deployer (≥0.05 ETH; Anvil `#0`–`#9` refused)
- [ ] `pnpm sepolia:deploy` completed; `WRITE_CHAIN_MANIFEST=1` wrote real addresses
- [ ] `pnpm sepolia:verify` (or documented Basescan retry)
- [ ] Chainlink VRF adapter deployed + consumer added + `node scripts/sepolia-merge-vrf-adapter.mjs …`
- [ ] `pnpm manifest:codegen` committed with non-null `baseSepolia` protocol fields
- [ ] `ATTESTOR_MIN_SIGNATURES` ≥ 3 with distinct staging keys
- [ ] Staging Supabase migrations applied; env labelled **testnet**
- [ ] Hosted API / game / dealer / verifier / indexer / worker pointed at Sepolia manifest (`docs/WP-086_HOSTED_DEPLOYMENT.md`)

## Health + pointers

- [ ] `pnpm testnet:health` (set `TESTNET_API_URL`, etc.)
- [ ] `pnpm testnet:verify-hints` reviewed and shared with team
- [ ] `pnpm watchtower` offline suite green
- [ ] Admin solvency page reachable against staging API

## Custody smoke (team wallets only)

- [ ] Fund ArenaAccount with labelled test USDC / mUSDC
- [ ] Grant GamePermission within caps
- [ ] Lock → seal → play (≥ 1 hand) → settle → withdraw
- [ ] Indexer shows session; reindex from `deploymentBlock` if cold-starting
- [ ] Public `/verify/<sessionId>` returns coherent Plan 10 categories (no false `VERIFIED`)

## Pause drill

- [ ] Follow `PAUSE_RUNBOOK.md` — matchmaking pause + vault pause (staging Safe/timelock or owner)
- [ ] Confirm no new locks while paused
- [ ] Unpause after solvency green; record incident-drill note

## Stage A exit log

- [ ] Start date: __________
- [ ] End date (≥ 7 clean days): __________
- [ ] Critical incidents: 0 (or demote / extend)
- [ ] Sign-off (ops lead): __________

**Next:** Stage B invite pack — still test assets only; see WP-103 Stage B caps.
