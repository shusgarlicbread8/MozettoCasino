# Wave 13 — Sepolia Stage A go-live runbook

**Authority:** Phase 11 in `01_MASTER_EXECUTION_ROADMAP.md`, Plan 14 Sepolia program, WP-102 / WP-103  
**Prior:** Wave 11 Anvil RC gate **MET** (WP-106 golden `PASS` FAIL=0 GAP=0); WP-102 recipes DONE; WP-103 program scaffold DONE  
**Date:** 2026-08-07  
**Status:** **Ops runbook ready. Live broadcast blocked until a funded non-Anvil deployer exists.**

---

## Honest current state (do not invent)

| Check | Result |
|---|---|
| Wave 11 Anvil RC | **MET** |
| `pnpm testnet:stage-a-gate` | **FAIL** — 11 protocol addresses null in `baseSepolia.json` (+ VRF adapter null) |
| `pnpm sepolia:check` | **FAIL** — deployer is Anvil #0 (`0xf39F…`) with ~0 ETH on chain `84532` |
| `PRIVATE_KEY` in `.env.local` | Anvil default — **FORBIDDEN for live Sepolia broadcast** |
| Protocol addresses in `packages/chain-manifest/deployments/baseSepolia.json` | **Honest nulls** until `WRITE_CHAIN_MANIFEST=1` + `--broadcast` succeeds |

Recipes: `docs/WP-102_SEPOLIA_DEPLOYMENT.md`, `docs/WP-103_PUBLIC_TESTNET_PROGRAM.md`.  
Human checklist after gate green: `scripts/testnet/STAGE_A_CHECKLIST.md`.

**Do not** invent on-chain addresses, broadcast with Anvil keys, or claim Stage A live until `pnpm testnet:stage-a-gate` exits 0.

---

## Hard stops

1. **Never** set Sepolia `PRIVATE_KEY` to Anvil `#0`…`#9` (well-known Foundry defaults). `scripts/sepolia-deploy.sh` refuses them for `check` / `broadcast`.
2. **Never** invent or hand-edit protocol addresses into `baseSepolia.json`. Only `pnpm sepolia:deploy` (`WRITE_CHAIN_MANIFEST=1`) may write them.
3. **AWS Nitro / production TEE** is **not** a Stage A entry gate. Stage A uses the hosted non-enclave dealer (or mock attestation locally). Live Nitro remains an ops follow-up (`docs/WP-054_NITRO_ENCLAVE_DEALER.md`). Do not claim `productionTeeVerified` during Stage A.
4. No mainnet (`8453`) work in this wave.

---

## Ordered ops checklist

Execute **in order**. Tick only with evidence (command exit codes, Basescan links, committed manifest). Leave boxes unchecked while blocked.

### 0) Prerequisites (already true if Wave 11 green)

- [x] Wave 11 Anvil RC gate MET (WP-106–113; golden FAIL=0 GAP=0)
- [x] WP-102 Sepolia recipes present (`pnpm sepolia:*`)
- [x] WP-103 Stage A program + `pnpm testnet:stage-a-gate` scaffold
- [ ] Ops owns a **new** Base Sepolia deployer EOA (hardware wallet / ops secret manager — not Anvil)

### 1) Replace `PRIVATE_KEY` (non-Anvil)

- [ ] Generate or retrieve a **dedicated staging deployer** key (not Anvil `#0`–`#9`)
- [ ] Set in local / ops secret store only (never commit):
  - `PRIVATE_KEY=<ops deployer>`
  - `BASE_SEPOLIA_RPC_URL=<84532 RPC>` (or `SEPOLIA_RPC_URL` alias)
  - Prefer also: `FEE_TREASURY_ADDRESS`, `BASESCAN_API_KEY`
- [ ] Confirm Anvil defaults remain available for **local Anvil only** (separate env / machine). Do not reuse the Sepolia deployer as Anvil `#0`.
- [ ] `pnpm sepolia:check` — must **not** print Anvil addresses; Anvil key → hard FAIL

### 2) Fund deployer ≥ 0.05 ETH (Base Sepolia)

- [ ] Fund deployer on chain id **84532** with **≥ 0.05 ETH** (faucet / bridge / ops transfer)
- [ ] `pnpm sepolia:check` → `balance_gate=PASS (>= 0.05 ETH)` and `chain_id=84532`
- [ ] Optional: `pnpm sepolia:dry-run` (simulation; does **not** write manifest)

### 3) Live deploy (`pnpm sepolia:deploy`)

- [ ] Ops approval recorded (who / when)
- [ ] `pnpm sepolia:deploy` — broadcast + `WRITE_CHAIN_MANIFEST=1` + codegen
- [ ] Confirm `packages/chain-manifest/deployments/baseSepolia.json` has **non-null** V3 protocol addresses and real `deploymentBlock` (not invented)
- [ ] Commit manifest + codegen output on a dedicated ops PR (addresses from broadcast only)

### 4) Verify (Basescan)

- [ ] Prefer `--verify` during broadcast when `BASESCAN_API_KEY` is set
- [ ] Else: `pnpm sepolia:verify` (best-effort retry from manifest)
- [ ] Document any verify failures + retry plan (do not invent verified status)

### 5) Chainlink VRF adapter (WP-053)

- [ ] Create + fund Chainlink VRF v2.5 subscription on Base Sepolia (`vrf.chain.link`)
- [ ] Set `RANDOMNESS_BEACON_ADDRESS` from manifest; set `VRF_SUBSCRIPTION_ID`
- [ ] Deploy adapter:

```bash
cd contracts
forge script script/DeployChainlinkVrfAdapter.s.sol \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" --broadcast --verify -vv
cd ..
```

- [ ] Add adapter as VRF consumer; leave `ENABLE_MOCK_VRF=0` on Sepolia
- [ ] Merge + codegen:

```bash
node scripts/sepolia-merge-vrf-adapter.mjs 0x<adapter>
pnpm manifest:codegen
```

- [ ] Commit updated `chainlinkVrfAdapter` (real address only)

### 6) Attestors — 3-of-N (distinct staging keys)

- [ ] Provision **≥ 3 distinct** staging attestor keys (not Anvil defaults)
- [ ] Set `ATTESTOR_1_ADDRESS` / `ATTESTOR_2_ADDRESS` / `ATTESTOR_3_ADDRESS` (and role private keys in service env)
- [ ] Raise `ATTESTOR_MIN_SIGNATURES` to **≥ 3**
- [ ] Wire game / replay / dealer attestor roles per `docs/WP-065_ATTESTOR_SERVICES.md` and WP-102 env notes
- [ ] Confirm `pnpm testnet:stage-a-gate` attestor hints show SET / OK for min signatures

### 7) Hosted services (testnet-labelled)

Point stack at Sepolia manifest — prefer `@mozetto/chain-manifest` over scattered overrides. Recipes: `docs/WP-086_HOSTED_DEPLOYMENT.md`, cutover `docs/WP-110_HOSTED_DB_WS.md`, proof pipeline `docs/WP-112_HOSTED_PROOF_PIPELINE.md`.

- [ ] Staging Supabase migrations applied; `DATABASE_URL` labelled **testnet**
- [ ] Managed Redis if multi-replica game (`REDIS_URL`)
- [ ] Deploy / restart: API, game-server, dealer, replay-verifier, chain-indexer, settlement-worker, agent-runtime, proof-batch-publisher as needed
- [ ] Env: `MOZETTO_CHAIN_ENV=base-sepolia` / `NEXT_PUBLIC_CHAIN_ENV=base-sepolia`; public UI labelled **testnet**
- [ ] Indexer `DEPLOYMENT_BLOCK` / RPC from Sepolia manifest
- [ ] `pnpm testnet:health` (with `TESTNET_API_URL` etc.) green enough for team smoke
- [ ] Admin RBAC + solvency reachable (`docs/WP-094_AUDIT_RBAC.md`, `docs/WP-091_ADMIN_SOLVENCY_DASHBOARD.md`)

### 8) Nitro note (Stage A — deferred)

- [ ] **Acknowledge:** Stage A does **not** require live AWS Nitro. Hosted dealer may run non-enclave / mock attestation (`ENCLAVE_ATTESTATION_MODE=mock` locally).
- [ ] Do **not** set or advertise `productionTeeVerified=true` until WP-054 live Nitro + PCR/KMS path is ops-complete.
- [ ] Optional later: Nitro EIF / PCR publish tracked separately — not a blocker for `stage-a-gate`.

### 9) Stage A gate PASS

- [ ] `pnpm testnet:stage-a-gate` → **exit 0** (required protocol addresses + VRF adapter non-null)
- [ ] Team-only custody smoke per `scripts/testnet/STAGE_A_CHECKLIST.md` (fund → lock → settle → withdraw)
- [ ] Indexer reindex from `deploymentBlock`; `/verify` smoke; pause drill (`scripts/testnet/PAUSE_RUNBOOK.md`)
- [ ] Record Stage A start date in ops log; begin ≥ 7 clean calendar days before Stage B (WP-103)

---

## Command sequence (copy/paste once funded)

```bash
# 1–2) Non-Anvil key + ≥0.05 ETH on 84532
pnpm sepolia:check          # must PASS balance + refuse Anvil keys

# Optional simulation (no manifest write)
pnpm sepolia:dry-run

# 3) Live broadcast + manifest + codegen
pnpm sepolia:deploy

# 4) Verify if not done during broadcast
pnpm sepolia:verify

# 5) VRF adapter (after funded sub) — then merge
# forge script DeployChainlinkVrfAdapter.s.sol … --broadcast --verify
# node scripts/sepolia-merge-vrf-adapter.mjs 0x…
pnpm manifest:codegen

# 6–7) Raise attestors + point hosted services at manifest (manual ops)

# 9) Gate
pnpm testnet:stage-a-gate   # must exit 0 before team Stage A exercises
```

---

## Exit criteria (Wave 13 Stage A entry)

| # | Criterion | Evidence |
|---|---|---|
| 1 | Funded non-Anvil deployer | `pnpm sepolia:check` PASS |
| 2 | Live V3 deploy | Non-null `baseSepolia.json` from broadcast |
| 3 | Basescan verify | Verified or documented retry |
| 4 | VRF adapter merged | `chainlinkVrfAdapter` non-null + codegen |
| 5 | Attestor ≥ 3-of-N | Distinct staging keys; `ATTESTOR_MIN_SIGNATURES≥3` |
| 6 | Hosted testnet stack | Services on Sepolia manifest; UI labelled testnet |
| 7 | Nitro honesty | No false TEE claim; Nitro deferred |
| 8 | Gate | `pnpm testnet:stage-a-gate` exit **0** |

Then follow WP-103 Stage A exercises / exit → Stage B over **weeks**.

---

## Security

- Never commit `PRIVATE_KEY`, attestor keys, or `.env.local`.
- Anvil defaults are for chain `31337` only.
- `WRITE_CHAIN_MANIFEST` prevents dry-run simulated addresses from becoming truth.
- Mainnet remains blocked under WP-105 (`finalGateApproval=false`).

---

## Completion template

```
Work packet: Wave 13 / Stage A go-live runbook
Status: RUNBOOK_READY (live Stage A BLOCKED on funded non-Anvil deployer)
Artifacts:
- docs/WAVE_13_STAGE_A_GO_LIVE.md
- scripts/sepolia-deploy.sh (Anvil #0–#9 refuse for live Sepolia)
- mozetto_execution_plans/PROGRESS.md (Wave 13 + session log)
Commands (current honesty):
- pnpm sepolia:check            → FAIL (Anvil key / ~0 ETH) until ops key funded
- pnpm testnet:stage-a-gate    → FAIL (null protocol addresses) until sepolia:deploy
Commands (ops after fund):
- pnpm sepolia:deploy → sepolia:verify → VRF adapter merge → testnet:stage-a-gate PASS
Spec clauses: none mutated; Plan 14 Stage A entry only
Follow-up: ops fund deployer → broadcast → Stage A checklist → B/C → WP-104 → WP-105
```
