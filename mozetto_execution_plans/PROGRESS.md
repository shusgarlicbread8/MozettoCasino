# Mozetto Execution Progress Tracker

**Authority:** Follows `00_READ_ME_FIRST.md`, `01_MASTER_EXECUTION_ROADMAP.md`, `16_AGENT_WORK_PACKETS.md`, `17_FINAL_DEFINITION_OF_DONE.md`.  
**Rule:** Protocol V3 specs are **frozen** (WP-010–015). Implementations MUST match `/specs` and fail CI if vectors diverge. Do not invent new encodings.  
**Last updated:** 2026-08-07 (WP-124 Wallet / ArenaAccount DONE; WP-122–123 + WP-121 + WP-120 DONE; Wave 11 + Wave 12 parallel; Plan 20A IN_PROGRESS)

---

## How to use this file

1. Update status at the start and end of every work turn.
2. Status values: `NOT_STARTED` · `IN_PROGRESS` · `BLOCKED` · `DONE` · `DEFERRED`
3. A work packet is `DONE` only when acceptance evidence exists (not merely “code compiles”).
4. Specs that are started must be finished to frozen/draft-complete before moving on—no half-written canonical docs.
5. Link artifacts (paths, PRs, commands, tags) under each completed item.

---

## Current focus

| Field | Value |
|---|---|
| **Active wave** | **Wave 11 Production Integration** + **Wave 12 Consumer UX** (parallel) |
| **Active packets** | WP-106–113 (Track A/C), WP-125–132 (Track B; WP-120–124 DONE); Sepolia Stage A blocked until WP-106–112 green |
| **Architecture status** | Protocol architecture largely built (~component-complete). Remaining work is integration, productization, hosted staging — **not** “ops only.” |
| **Blocked until (Sepolia Stage A)** | WP-106–112 green on Anvil release candidate; then funded Sepolia deploy |
| **Hard stop** | No new architecture invention; live AWS Nitro during Stage A; Plan 15 expansion stays deferred |
| **WP-100 correction** | WP-100 = `PASS_WITH_GAPS` only. Gaps reopened as WP-106–108 (sealAndFund, API match, live AI hands, real roots). |
| **Wave 0 note** | Packets DONE; `baseline-v2` tag optional (create only when user requests) |
| **Plan 02 note** | Specs **frozen**; WP-015 TS/Rust/Solidity hashes identical |
| **Plan 11 note** | Rake/treasury code DONE; Season 1 schedule = hypotheses until WP-111 empirical COGS |
| **Plan 12 note** | Ratings / anti-cheat DONE — ML collusion deferred |
| **Plan 19 note** | Schema map DONE; hosted cutover **WP-110 DONE** (GRANTs `030`, scheduler persist, WS dual-accept) |
| **Plan 20A note** | **Consumer UX IN_PROGRESS** (WP-120–124 DONE → WP-125+); Plan 20B cinematic 3D remains DEFERRED |
| **Anvil release candidate** | Normal user can Find Match → Groq AI session → verify → withdraw with **zero GAPs** (WP-106–112) |

---

## Phase rollup (Roadmap 01)

| Phase | Name | Status | Notes |
|---|---|---|---|
| 0 | Repository stabilization | `DONE` | WP-000 + WP-001 complete; tag `baseline-v2` when user requests |
| 1 | Freeze protocol V3 specs | `DONE` | WP-010–015 frozen; TS/Rust/Solidity vectors agree |
| 2 | Harden custody and permissions | `DONE` | WP-020–025 DONE; invariant suite green @ 256 runs |
| 3 | Sealed session lifecycle | `DONE` | WP-023 + WP-040–043 DONE (Wave 4 matchmaking gate) |
| 4 | Deterministic poker core + Rust parity | `DONE` | WP-030–035 complete; Wave 3 gate met |
| 5 | Verifiable randomness + confidential dealer | `DONE` | WP-050–055 DONE — Wave 5 gate met (mock enclave; live Nitro deferred to ops) |
| 6 | Event roots, proofs, settlement V3 | `DONE` | WP-060–066 DONE — Wave 6 settlement/proof gate met |
| 7 | Groq GPT-OSS 120B Season 1 agent | `DONE` | WP-070–077 DONE — Wave 7 AI gate met (offline) |
| 8 | Continuous cognition + 100 Energy | `DONE` | WP-072–076 DONE (scheduler + Energy + cadence + fallback) |
| 9 | Full Anvil protocol integration | `IN_PROGRESS` | WP-100 `PASS_WITH_GAPS`; Wave 11 (WP-106–113) closes zero-GAP Anvil RC |
| 10 | Operations, admin, public verification | `DONE` | WP-090–095 DONE — Wave 9 product integrity gate met |
| 11 | Base Sepolia deployment | `BLOCKED` | Recipes ready; Stage A gated on Wave 11 WP-106–112 |
| 12 | Adversarial program and audits | `BLOCKED` | Program/register scaffolds DONE; live A/B/C after Anvil RC + Sepolia deploy |
| 13 | Restricted Base Mainnet | `BLOCKED` | WP-105 recipes/gates DONE; `finalGateApproval=false` |
| 14 | Consumer product UX (Plan 20A) | `IN_PROGRESS` | Wave 12 WP-120–132 (WP-120–121 DONE); 3D production (20B) deferred |

---

## Plan document status (02–20)

| Plan | Subject | Status | Started | Finished | Artifact / notes |
|---|---|---|---|---|---|
| 00 | Read me / locked decisions | `DONE` | — | pack authored | Source of truth; not an implementation plan |
| 01 | Master execution roadmap | `DONE` | — | pack authored | Authoritative sequence |
| 02 | Protocol and canonical specs | `DONE` | 2026-08-07 | 2026-08-07 | `/specs` frozen; WP-015 exit gate passed |
| 03 | Base custody wallets permissions | `DONE` | 2026-08-07 | 2026-08-07 | WP-020–025 DONE; invariants @ 256 (+1000 extended) |
| 04 | Game registry session matchmaking | `DONE` | 2026-08-07 | 2026-08-07 | WP-022–023, WP-040–043 DONE |
| 05 | Randomness confidential dealer | `DONE` | 2026-08-07 | 2026-08-07 | WP-050–055 DONE (WP-054 mock scaffold; live Nitro ops follow-up) |
| 06 | Poker engine Rust canonical core | `DONE` | 2026-08-07 | 2026-08-07 | WP-030–035 DONE; Wave 3 gate met |
| 07 | Realtime backend Supabase infra | `DONE` | 2026-08-07 | 2026-08-07 | WP-080–086 DONE — Wave 8 backend gate met |
| 08 | Groq GPT-OSS 120B AI runtime | `DONE` | 2026-08-07 | 2026-08-07 | WP-070–077 DONE |
| 09 | Continuous cognition Energy timing | `DONE` | 2026-08-07 | 2026-08-07 | WP-072–076 DONE (Plan 09 exit gate) |
| 10 | Event log proof batching settlement | `DONE` | 2026-08-07 | 2026-08-07 | WP-060–066 DONE — Wave 6 gate met |
| 11 | Rake unit economics treasury | `DONE` | 2026-08-07 | 2026-08-07 | `docs/PLAN_11_RAKE_TREASURY.md`; Season 1 schedule = hypotheses; see deferrals |
| 12 | Ratings anti-cheat collusion | `DONE` | 2026-08-07 | 2026-08-07 | `docs/PLAN_12_RATINGS_ANTICHEAT.md`; gate/pairing/aggression tests; ML collusion deferred |
| 13 | Admin governance security ops | `DONE` | 2026-08-07 | 2026-08-07 | WP-090–095 DONE — Plan 13 ops/governance scaffold complete |
| 14 | Anvil Sepolia Mainnet audit | `IN_PROGRESS` | 2026-08-07 | | Wave 11 Anvil RC before Stage A; recipes WP-102–105 ready |
| 15 | Game expansion Open AI league | `DEFERRED` | | | Explicitly deferred until restricted mainnet NLHE stable |
| 16 | Agent work packets | `DONE` | — | pack authored | Assignment catalog (+ Wave 11/12 packets) |
| 17 | Final definition of done | `DONE` | — | pack authored | Completion checklist |
| 18 | Sources and decision log | `DONE` | — | pack authored | Locked decisions log |
| 19 | Database schema API migration | `DONE` | 2026-08-07 | 2026-08-07 | Map DONE; hosted cutover WP-110 DONE |
| 20A | Consumer product UX | `IN_PROGRESS` | 2026-08-07 | | Wave 12 WP-120–132 — WP-120–121 DONE; WP-122+ next |
| 20B | Full 3D production | `DEFERRED` | | | After 2D table + WP-132 adapter prove themselves |

---

## Work packet board

### Wave 0 — Baseline

| ID | Packet | Status | Owner / agent | Branch | Acceptance evidence |
|---|---|---|---|---|---|
| WP-000 | Reproducible local bootstrap | `DONE` | agent | `feat/arena-account-poker-classic-split` | `pnpm bootstrap` + readiness report; CI `.github/workflows/ci.yml`; E2E core path evidence (see session log) |
| WP-001 | Current architecture manifest | `DONE` | agent | `feat/arena-account-poker-classic-split` | `docs/architecture-manifest.v2.json` + `.md`; regenerate via `pnpm manifest:architecture` |

**Wave 0 gate:** both DONE + `baseline-v2` tag ready (tag only when user requests).

### Wave 1 — Specifications

| ID | Packet | Status | Artifact path | Acceptance evidence |
|---|---|---|---|---|
| WP-010 | Protocol V3 spec | `DONE` (draft-complete) | `specs/MOZETTO_PROTOCOL_V3.md`, `MOZETTO_GAME_TEMPLATE_V2.md`, `MOZETTO_SESSION_V2.md`, `specs/README.md` | Shared primitives, domains, money/cards/seats, Merkle, version rules |
| WP-011 | Poker event spec | `DONE` (draft-complete) | `specs/MOZETTO_POKER_EVENT_V1.md` + vectors 03–06 | Event ABI hash chain; incomplete all-in; side pots; odd chip |
| WP-012 | Randomness spec | `DONE` (draft-complete) | `specs/MOZETTO_RANDOMNESS_V2.md` + vectors 07–08 | Secret/VRF/handSeed/shuffle/card leaf/deck batch |
| WP-013 | Settlement/proof spec | `DONE` (draft-complete) | `specs/MOZETTO_SETTLEMENT_V3.md`, `MOZETTO_PROOF_BATCH_V1.md` + vectors 12–14 | Balance leaves, EIP-712 V3, proof batch, emergency exit |
| WP-014 | Controller/Energy spec | `DONE` (draft-complete) | `specs/MOZETTO_CONTROLLER_V1.md`, `MOZETTO_ENERGY_V1.md` + vectors 09–11 | Profile/model policy, controller req/resp, 100 Energy ledger |
| WP-015 | Cross-language vectors | `DONE` | `packages/protocol-vectors-ts`, `crates/protocol-vectors-rs`, `contracts/test/ProtocolVectors.t.sol` | TS 16/16, Rust 15/15, Solidity 15/15; specs frozen |

**Wave 1 gate:** DONE — golden vectors identical across TypeScript, Rust, and Solidity; specs frozen.

### Wave 2 — Custody and session contracts

| ID | Status |
|---|---|
| WP-020 ArenaAccount/GamePermission review | `DONE` |
| WP-021 SeatTicket V3 and atomic funding | `DONE` |
| WP-022 GameRegistryV2 | `DONE` |
| WP-023 Session lifecycle contract state | `DONE` |
| WP-024 ProtocolFeeVault + settlement destinations | `DONE` |
| WP-025 Contract invariants (independent fuzz) | `DONE` |

**Wave 2 gate:** DONE — no invariant failure at agreed run count (256; extended 1000 also green).

### Wave 3 — Poker core

| ID | Status |
|---|---|
| WP-030 Freeze TS engine behavior | `DONE` |
| WP-031 Rust HU core | `DONE` |
| WP-032 Rust six-max core | `DONE` |
| WP-033 Hand evaluator | `DONE` |
| WP-034 Differential oracle harness | `DONE` |
| WP-035 WASM verifier | `DONE` |

### Wave 4 — Matchmaking / session

| ID | Status |
|---|---|
| WP-040 Ranked random matchmaker | `DONE` |
| WP-041 Session seal coordinator | `DONE` |
| WP-042 Epoch join/leave rotation | `DONE` |
| WP-043 Anti-pairing and identity hooks | `DONE` |

### Wave 5 — Randomness / dealer (**blocked until WP-012 frozen**)

| ID | Status |
|---|---|
| WP-050 RandomnessBeaconV2 | `DONE` |
| WP-051 Dealer deterministic deck library | `DONE` |
| WP-052 Mock VRF Anvil integration | `DONE` |
| WP-053 Chainlink VRF adapter | `DONE` |
| WP-054 Nitro Enclave dealer | `DONE` |
| WP-055 Randomness verifier CLI | `DONE` |

**Wave 5 gate:** DONE for Anvil/local — mutation tests + public card proofs (WP-055) and mock enclave attestation path (WP-054). Live AWS Nitro EIF/PKI remains an ops follow-up (not a production TEE claim).

### Wave 6 — Proofs and settlement (**blocked until WP-013 frozen**)

| ID | Status |
|---|---|
| WP-060 Canonical event store/hash chain | `DONE` |
| WP-061 Hand/balance root builder | `DONE` |
| WP-062 ProofBatchRegistryV1 | `DONE` |
| WP-063 VerifierRouter/SettlementHubV3 | `DONE` |
| WP-064 Replay verifier service | `DONE` |
| WP-065 Attestor services | `DONE` |
| WP-066 Emergency exit | `DONE` |

### Wave 7 — AI (**continuous cognition blocked until WP-014 frozen**)

| ID | Status |
|---|---|
| WP-070 Groq provider adapter | `DONE` |
| WP-071 Master policy and profile system | `DONE` |
| WP-072 AgentState store | `DONE` |
| WP-073 Continuous cognition scheduler | `DONE` |
| WP-074 Energy ledger | `DONE` |
| WP-075 Public cadence controller | `DONE` |
| WP-076 Deterministic fallback | `DONE` |
| WP-077 Poker evaluation harness | `DONE` |

### Wave 8 — Backend and chain integration

| ID | Status |
|---|---|
| WP-080 Table actor lease/recovery | `DONE` |
| WP-081 Persist-before-broadcast outbox | `DONE` |
| WP-082 Chain indexer V3 | `DONE` |
| WP-083 Reconciliation worker | `DONE` |
| WP-084 Settlement worker V3 | `DONE` |
| WP-085 Proof-batch publisher | `DONE` |
| WP-086 Hosted deployment recipes | `DONE` |

### Wave 9 — Product integrity surfaces

| ID | Status |
|---|---|
| WP-090 Public Verify Game page | `DONE` |
| WP-091 Admin chain/solvency dashboard | `DONE` |
| WP-092 Admin session/randomness/AI dashboard | `DONE` |
| WP-093 Safe/timelock proposal integration | `DONE` |
| WP-094 Audit log and RBAC | `DONE` |
| WP-095 Watchtower prototype | `DONE` |

### Wave 10 — Testing and release

| ID | Status |
|---|---|
| WP-100 Full Anvil E2E | `DONE` (`PASS_WITH_GAPS` — gaps → WP-106–108) |
| WP-101 Chaos suite | `DONE` (unit path; live multi-container → WP-113) |
| WP-102 Sepolia deployment/manifest | `DONE` (recipes; live tx pending ops) |
| WP-103 Public testnet program | `DONE` (program scaffold; Stage A after Wave 11) |
| WP-104 Audit remediation | `DONE` (register scaffold; no external audit claimed) |
| WP-105 Restricted mainnet deployment | `DONE` (recipes/gates; live restricted mainnet BLOCKED) |

### Wave 11 — Production Integration (Anvil RC before Sepolia Stage A)

| ID | Work | Status | Exit condition |
|---|---|---|---|
| WP-106 | True full Anvil match lifecycle | `IN_PROGRESS` | Browser/API → match → SeatTicket V3 → `sealAndFundSession` → real game → settle → withdraw; **zero GAPs** |
| WP-107 | Live Groq AI table integration | `DONE` | Game-server runs Groq seats + cognition + Energy + cadence for complete sessions |
| WP-108 | Real canonical roots | `IN_PROGRESS` | AI gameplay produces real eventRoot/handRoot/balanceRoot (no stub settlement roots) |
| WP-109 | Poker release hardening | `IN_PROGRESS` | Uncalled bets, deep 6-max, sit-out/timeout; PokerKit mandatory oracle; large generated set |
| WP-110 | Hosted DB + WS cutover | `DONE` | Migrations 017–030; GRANTs; scheduler DB persist; WS v2 dual-accept |
| WP-111 | Economics instrumentation | `IN_PROGRESS` | Actual Groq/chain/VRF/relayer/cloud COGS + rake contribution per hand |
| WP-112 | Hosted proof pipeline | `IN_PROGRESS` | Continuous CheckpointSource → publisher → SQL proofs → Verify page |
| WP-113 | Live chaos completeness | `NOT_STARTED` | Multi-container Redis/RPC/VRF/dealer/worker/settlement failure drills |

**Wave 11 gate:** WP-106–112 green ⇒ Anvil release candidate. Do **not** open Sepolia Stage A before this gate.

**Golden path (WP-106):** Web/API → Find Match → random allocation → SeatTicket V3 → atomic `sealAndFundSession` → SessionLifecycle → dealer commit → VRF (Anvil mock OK) → deck → real game-server → Groq AI → canonical events → roots → proof batch → replay → attestors → Hub V3 → FeeVault → ArenaAccounts → Verify Game. One command. Fail anywhere = FAIL.

### Wave 12 — Consumer Product UX (Plan 20A; parallel with Wave 11)

| ID | Surface | Status |
|---|---|---|
| WP-120 | Product IA / design system | `DONE` |
| WP-121 | Home (Play Now first) | `DONE` |
| WP-122 | Play / Find Match | `DONE` |
| WP-123 | Strategy setup (profiles + tuning) | `DONE` |
| WP-124 | Wallet / onboarding (ArenaAccount) | `DONE` |
| WP-125 | Live table 2D premium | `IN_PROGRESS` |
| WP-126 | AI cognition presentation | `IN_PROGRESS` |
| WP-127 | Result / replay | `IN_PROGRESS` |
| WP-128 | Verify UX (trust badge → deep verify) | `IN_PROGRESS` |
| WP-129 | Watch / spectator | `NOT_STARTED` |
| WP-130 | Rankings / profile | `IN_PROGRESS` |
| WP-131 | Mobile / performance | `NOT_STARTED` |
| WP-132 | 3D event adapter (no art dependency) | `IN_PROGRESS` |

**Wave 12 rule:** UX must not mutate protocol semantics. Feel = competitive autonomous gaming with verifiable settlement — not crypto-trading infrastructure.

### Wave 13 — Hosted staging / Sepolia (after Wave 11 gate)

Hosted Postgres/Redis + all services → observability → fund deployer → `pnpm sepolia:deploy` → verify → VRF → 3-of-N attestors → Stage A. Production Nitro during Stage A. Then B → C → audits → WP-105 mainnet.

---

## Session log

### 2026-08-07 — WP-124 Wallet / onboarding (ArenaAccount) (DONE)

**Status:** `DONE`

**Delivered:**
- Rebuilt `/wallet` on WP-120 tokens: Available / At Tables / Settling / Total; Fund / Withdraw / Play Now
- Seamless Play panel: enabled, max single game, max at risk, expiry; copy that Mozetto cannot withdraw idle funds
- Fund + withdraw pages wired to demo custody APIs and ArenaAccount address / `fund-test` / owner `withdraw`
- `ArenaWithdrawPanel` + `arenaAccountAbi`; honest empty states throughout
- Docs: `docs/WP-124_WALLET_ONBOARDING.md`

**Commands / evidence:**
- `pnpm --filter @mozetto/web typecheck` — pass

**Out of scope:** Spec mutations; InstantPermission revive; Find Match overlay (WP-122); live table polish (WP-125+).

**Follow-up:** WP-125 Live table 2D; migrate remaining legacy green Find Match chrome onto tokens.

### 2026-08-07 — WP-122 Play / Find Match (DONE)

**Status:** `DONE`

**Delivered:**
- Consumer Play flow on WP-120 tokens: Game → League (Bronze→Platinum) → AI profile → Tune (`/my-ai` WP-123) → Find Match
- Searching / sealing / seating status UI; clear loading + error states
- `profileConfigHash` returned at queue entry (`waiting`) and shown as locked in UI; integrates WP-123 strategy draft / preferred profile
- Routes: `/poker`, `/poker/classic` via `ArenaFindMatch`
- Docs: `docs/WP-122_PLAY_FIND_MATCH.md`

**Commands / evidence:**
- `pnpm --filter @mozetto/web typecheck` — pass
- `pnpm --filter @mozetto/api typecheck` — blocked by pre-existing `@mozetto/session-seal` resolve (WP-106 track); WP-122 API delta is additive `profileConfigHash` fields only

**Out of scope:** Spec mutations; WP-123 trait sliders (done separately); WP-124 wallet onboarding polish.

**Follow-up:** WP-124 Wallet / ArenaAccount.

### 2026-08-07 — WP-123 Strategy setup (DONE)

**Status:** `DONE`

**Delivered:**
- Strategy UI on `/my-ai` (+ `/my-ai/setup`): Shark / Fox / Professor / Machine, six bounded traits, behavioral preview (no ROI promises)
- Preset + matchmaking hash helpers wired to WP-071 / `agent_profile_versions` seed hashes
- Find Match reads preferred `profileKey`, shows `profileConfigHash` lock, links Tune → `/my-ai`
- Removed free-text coaching / CoT editor from AI Strategy surface
- Docs: `docs/WP-123_STRATEGY_SETUP.md`

**Commands / evidence:**
- `pnpm --filter @mozetto/web typecheck` — pass

**Out of scope:** Spec mutations; API axis-envelope accept path (runtime ready); guaranteed-return copy.

**Follow-up:** WP-122 Play polish; promote full PROFILE_V1 hashes when find-match accepts typed axes.

### 2026-08-07 — WP-121 Home (Play Now first) (DONE)

**Status:** `DONE`

**Delivered:**
- Rebuilt `apps/web/src/app/(app)/home/page.tsx` on WP-120 tokens / `Button` / `LeagueChip`
- Play Now hero + bankroll; league strip from `/v1/arena`; AI ready from `/v1/me`; rating from `/v1/profiles/:handle`; today P&L from net-worth when snapshots exist
- Removed design-mock game browser / fake HOT pots / mock tournament CTA
- Docs: `docs/WP-121_HOME.md`

**Commands / evidence:**
- `pnpm --filter @mozetto/web typecheck` — pass

**Out of scope:** Spec mutations; Find Match overlay (WP-122); strategy sliders (WP-123); protocol field changes.

**Follow-up:** WP-122 Play / Find Match; WP-123 Strategy setup.

### 2026-08-07 — WP-120 Product IA / design system (DONE)

**Status:** `DONE`

**Delivered:**
- Design tokens + night-felt atmosphere in `apps/web` (`globals.css`, `lib/design-tokens.ts`)
- Typography: Syne (display) / DM Sans / IBM Plex Mono
- Nav IA: Home · Play · AI/Strategy · Wallet · Rankings · Watch; Verify/Replays/Settings secondary; **Play Now** primary CTA
- Lean primitives: `Button`, `LeagueChip`, `BrandMark`
- Brand-first landing first viewport (competitive AI poker, not crypto dashboard)
- Docs: `docs/WP-120_PRODUCT_IA_DESIGN.md`

**Commands / evidence:**
- `pnpm --filter @mozetto/web typecheck` — pass

**Out of scope:** Spec mutations; 3D production art (Plan 20B); protocol field changes; full Home rewrite (WP-121).

**Follow-up:** WP-121 Home (Play Now first); WP-122 Find Match; migrate remaining legacy green/Geist page styles onto tokens.

### 2026-08-07 — Wave 11/12 opened (productionization correction)

**Correction:** “Remaining items are ops only” was too optimistic. Architecture ~component-complete; local full integration, consumer UX, hosted staging, live Sepolia, production TEE, and external audit remain.

**Opened:** WP-106–113 (Track A/C), WP-120–132 (Track B), Plan 20A Consumer UX `IN_PROGRESS`, Plan 20B 3D `DEFERRED`.

**Priority order:** WP-106 → 107 → 108 → 109 ‖ WP-120 → 121… ‖ WP-110 → 111 → 112 → 113 → Anvil RC → Sepolia Stage A.

**DB:** `pnpm db:migrate` applied **017–030** to configured `DATABASE_URL` (2026-08-07). WP-110 closed GRANTs + WS dual-accept + scheduler persist hooks.

### 2026-08-07 — Plan 12 Ratings / anti-cheat / collusion (DONE)

**Status:** `DONE` (with honest deferrals)

**Delivered:**
- Plan → code map: `docs/PLAN_12_RATINGS_ANTICHEAT.md`
- `@mozetto/ratings` modules: `pairing.ts`, `rating-update-gate.ts`, `abuse-states.ts`, `risk-signals.ts` (+ existing Glicko / aggression)
- `settleRatedMatch` applies Plan 12 gate; stake never scales Glicko; six-max Season 1 unrated
- Pair weight bands owned by ratings package; WP-043 `pairRatingWeight` re-exports
- Settlement-worker passes gate refs (`sessionId` + proof root)
- Tests: HU gate / aggression shrink / pairing weights / abuse FSM / non-punitive risk signals

**Commands / evidence:**
- `pnpm --filter @mozetto/ratings test` — **15/15** pass
- `pnpm --filter @mozetto/database test` — **42/42** pass (includes WP-043 pair bands)
- `pnpm --filter @mozetto/ratings typecheck` + `pnpm --filter @mozetto/database typecheck` — pass
- No `/specs` mutations

**Spec clauses:** Plan 12 exit gate (rating farming / linked-seat / pair-cap controls); agents are loadouts; stake ≠ rating multiplier.

**Out of scope / intentional gaps:** Production ML collusion detector; persistent linked-account DB; rating-band wait expansion; fair six-max Bayesian rating; live coaching queue / spectator-delay UX; wallet-cluster ingestion.

**Follow-up:** Plan 13 admin review UI for abuse states + link graph; product enforcement of multiway hole-card policy; Plan 11 close.

### 2026-08-07 — Session start

- Read `00`, `01`, Wave 0–1 of `16`, and Plan `02` entry rules.
- Confirmed: no `/specs` directory yet; no `.github` CI; `scripts/start-local.sh` exists but is not a single documented fresh-clone bootstrap; migrations `001`–`016` present.
- Created this tracker.
- Launched parallel agents for **WP-000** (bootstrap/CI/pins) and **WP-001** (architecture manifest).
- **Explicitly not starting:** WP-050+, WP-063, Rust engine, continuous Groq.

### 2026-08-07 — WP-001 complete

- Delivered machine-readable V2 architecture manifest (scan-generated; no runtime behavior change).
- Artifacts:
  - `docs/architecture-manifest.v2.json`
  - `docs/architecture-manifest.v2.md` (human summary)
  - Generator: `scripts/generate-architecture-manifest.mjs`
  - Root script: `pnpm manifest:architecture`
- Coverage verified: 10 contracts, 7 services, 2 apps, 9 packages, migrations `001`–`016`, Anvil deployment keys, env names from `.env.example`, E2E/smoke scripts, local ports, protocol status markers.
- Did not start `/specs` or alter contracts/services.

### 2026-08-07 — Wave 0 closed → Wave 1 opened

- Verified WP-000 artifacts on disk; `check-prereqs` OK (Node 26 local warn); `pnpm test:unit` + `pnpm test:contracts` (42) pass.
- Wave 0 work-packet gate closed. Optional `baseline-v2` tag still awaits explicit user request (do not block specs on tag).
- Plan 02 marked `IN_PROGRESS`. Launching one coordinated agent for WP-010–014 (full `/specs` suite) so encodings stay consistent; WP-015 follows after draft freeze.

### 2026-08-07 — WP-000 complete

**Status:** `DONE` (with documented E2E join caveat)

**Delivered:**
- Version pins: `.nvmrc` / `.node-version` (Node 22), `.foundry-version` (v1.7.1), `rust-toolchain.toml` (1.85.0), `docs/TOOL_VERSIONS.md`, `package.json` `engines`, Foundry `solc 0.8.24` comment
- Bootstrap: `pnpm bootstrap` → `scripts/bootstrap.sh` (prereqs, install, env prep without clobbering secrets, optional `--docker-db`, migrate, Anvil reset, start services, readiness)
- Reset: `pnpm reset:local` / `scripts/reset-local.sh` (`--db` / `--db-only`)
- Readiness: `pnpm readiness` / `scripts/readiness-report.sh`
- Docker Compose: Postgres 16 + Redis 7
- CI: `.github/workflows/ci.yml` (unit + typecheck:ci + forge test + migrations on Postgres 16)
- README quick start updated to single command sequence; `.env.example` documents `DATABASE_URL` honestly
- Removed production hardcoded rankings fallback on `apps/web/.../rankings/page.tsx`; flagged home design-mock TABLES
- SSL-aware DB clients for local Postgres (`migrate.mjs`, `apply-migration.mjs`, `packages/database/src/client.ts`)
- `services/game-server/tsconfig.json` + `@types/node` on game-rules/ratings so `pnpm typecheck:ci` is green

**Commands run (evidence):**
- `bash ./scripts/check-prereqs.sh` — OK (Node 26 local warn vs pin 22)
- `pnpm test:unit` — pass
- `pnpm test:contracts` / `forge test` — 42 pass
- `pnpm typecheck:ci` — pass
- `pnpm db:migrate` against Supabase pooler — migrations 001–016 skipped/applied complete
- `bash ./scripts/bootstrap.sh --reset --no-start` — Anvil 31337 + DeployLocal + readiness addresses
- One-shot Anvil+API+game + `pnpm e2e:arena-account`:
  - SIWE → ArenaAccount → fund → GamePermission → find-match → **V2 locks confirmed (100000000 / 100000000)**
  - Game join returned `Insufficient available balance` (script still prints path OK; join is non-fatal in existing E2E)
- Docker Compose dry-run **not** executed locally (Docker daemon not running); CI job covers empty-DB migrate

**Known limitations:**
- Live Anvil E2E not in default CI (manual / `workflow_dispatch` stub); needs long-lived Anvil + API + game + `DATABASE_URL`
- Local machine Node v26 vs engines `>=22 <23` (CI uses 22)
- `--docker-db` requires Docker daemon
- Table join after on-chain lock still fails on demo ledger “available balance” — pre-existing product issue, not invented as pass

**Follow-up:** user may tag `baseline-v2`; Wave 1 specs next.

### 2026-08-07 — WP-010–014 draft-complete (Plan 02 specs)

**Status:** WP-010–014 `DONE` (draft-complete); Plan 02 remains `IN_PROGRESS` until WP-015 exit gate.

**Delivered `/specs` tree:**
- `specs/README.md` — index, status table, how to use
- `specs/MOZETTO_PROTOCOL_V3.md` — primitives, domain table, money, cards `0..51`, Merkle, upgrades
- `specs/MOZETTO_GAME_TEMPLATE_V2.md`
- `specs/MOZETTO_SESSION_V2.md`
- `specs/MOZETTO_POKER_EVENT_V1.md`
- `specs/MOZETTO_RANDOMNESS_V2.md`
- `specs/MOZETTO_CONTROLLER_V1.md`
- `specs/MOZETTO_ENERGY_V1.md`
- `specs/MOZETTO_SETTLEMENT_V3.md`
- `specs/MOZETTO_PROOF_BATCH_V1.md`
- `specs/canonical-vectors/` — README + `_domains.json` + vectors `01`–`14`
- Helper: `scripts/compute-canonical-vectors.mjs` (viem keccak/ABI; regenerate fixtures)

**Encoding notes:**
- Domain tags = `keccak256(bytes(DOMAIN_STRING))`; object hashes = `keccak256(abi.encode(domain, …))`
- Card mapping matches Plan 02 and current `game-rules` suit-major order; V3 forbids legacy modulo-biased shuffle
- Settlement EIP-712: `MozettoPokerSettlement` version `"3"` (`FinalSettlementV3`)
- Season 1 Energy 100/hand, reserve 12; Groq `openai/gpt-oss-120b`; empirical defaults marked hypotheses

**Commands run:**
- `node scripts/compute-canonical-vectors.mjs` — wrote 14 vectors + domain digests

**Not done (by design):**
- WP-015 TS/Rust/Solidity harnesses
- No RandomnessBeaconV2 / SettlementHubV3 / Rust engine / Groq runtime implementation
- Specs remain `draft` (not `frozen`) until WP-015 agrees

**Follow-up:** WP-015 cross-language conformance → freeze specs → unlock Wave 2/3/5/6 implementation.

### 2026-08-07 — WP-015 Cross-language protocol vectors (DONE)

**Status:** WP-015 `DONE`; Plan 02 `DONE`; Phase 1 `DONE`. Specs `draft` → `frozen`.

**Delivered:**
- `packages/protocol-vectors-ts` (`@mozetto/protocol-vectors`) — ABI encoders + conformance tests reading `specs/canonical-vectors/`
- `crates/protocol-vectors-rs` + root `Cargo.toml` workspace — alloy `sol!` ABI encoders + fixture tests
- `contracts/test/ProtocolVectors.t.sol` — Foundry `stdJson` + independent `abi.encode` / EIP-712
- Root scripts: `pnpm test:protocol-vectors`, `:rs`, `:sol`, `:all`
- CI job `protocol-vectors` in `.github/workflows/ci.yml`
- Fixed generator bug: `scripts/compute-canonical-vectors.mjs` was double-encoding `canonicalBytesHex` via `toHex(alreadyHex)` (hashes were always correct; preimage display fixed and fixtures regenerated)

**Spec clauses:** Domain tags + `keccak256(abi.encode(...))` for objects 01–14; ordered Merkle; EIP-712 `FinalSettlementV3` / `MozettoPokerSettlement` v3.

**Commands / evidence:**
- `pnpm test:protocol-vectors` — **16/16 pass** (domains + 01–14 + inventory)
- `cargo test -p protocol-vectors-rs` — **15/15 pass** (domains + 01–14)
- `cd contracts && forge test --match-contract ProtocolVectors` — **15/15 pass** (domains + 01–14)

**Known limitations:**
- Local Node may be v26 vs engines `>=22 <23` (CI uses 22)
- Rust pins `ruint = "=1.14.0"` for rustc 1.85

**Security notes:** Fixture secrets/salts are test-only; production dealer secrets MUST be CSPRNG.

**Follow-up dependencies:** Wave 2 (WP-020+), Rust poker engine (WP after freeze), RandomnessBeaconV2 / SettlementHubV3 may proceed against frozen specs.

### 2026-08-07 — Phase 1 verified → parallel Wave 2/3/7 opened

- Re-ran `pnpm test:protocol-vectors:all`: TS/Rust/Solidity all pass; specs confirmed `frozen`.
- Opening parallel agents: WP-020 (Plan 03 custody review), WP-030 (freeze TS engine), WP-070 (Groq offline adapter only — no continuous cognition).

### 2026-08-07 — WP-070 Groq provider adapter (DONE)

**Status:** `DONE` (offline / provider layer only)

**Delivered:**
- `PokerModelProvider` interface + types in `services/agent-runtime/src/provider/`
- `GroqGptOss120BProvider` — model pinned `openai/gpt-oss-120b`, Groq chat completions, `response_format.json_schema.strict=true`, tools disabled
- Strict decision JSON Schema + Zod (`actionType` 10–15, `amount` decimal string, `publicCadenceMs`, `reasonCode` 0..13) aligned with ControllerResponseV1 spirit
- Health check (`/models`), 429/5xx retry + Retry-After, circuit breaker, `ProviderSloHooks`
- `DeterministicFallbackController` stub (check → call → fold → first legal @ min)
- Env docs: `.env.example` `GROQ_API_KEY` (no secrets committed)
- Unit tests with mocked `fetch` (18 pass); wired into `pnpm test:unit` + `typecheck:ci` / CI job labels
- Season 1 sampling/reasoning defaults marked **hypotheses** in `season1-policy.ts` / comments (`temperature=0`, `max_tokens=256`, `reasoning_effort=low`)

**Not done (by design / other packets):**
- WP-073 continuous cognition scheduler (stub `updateState` only)
- WP-074 Energy ledger integration
- WP-075 public cadence controller (placeholder `publicCadenceMs` only)
- WP-076 full auditable fallback policy
- Live Groq bake-off / multi-model UI

**Commands / evidence:**
- `pnpm --filter @mozetto/agent-runtime test` — **18/18 pass**
- `pnpm --filter @mozetto/agent-runtime typecheck` — pass

**Spec clauses:** Plan 08 provider abstraction; `MOZETTO_CONTROLLER_V1` §4–§8; vector `10_model_policy_groq.json`; `MOZETTO_ENERGY_V1` costs not charged here (WP-074).

**Follow-up:** WP-071 master policy/profiles; WP-076 expand fallback; do not start WP-073 loops yet.

### 2026-08-07 — WP-071 Master policy and profile system (DONE)

**Status:** `DONE` (policy/profile layer only; no continuous cognition)

**Delivered:**
- Master poker policy Season 1 text + frozen `masterPolicyHash` commitment (`master-poker-policy-season1-v1`) in `services/agent-runtime/src/policy/`
- Four presets: Shark / Fox / Professor / Machine (`PRESET_*` ids; Shark axes = vector 09)
- Bounded axes `0..100` + Season 1 envelope (±25 hypothesis) + PROFILE_V1 hashing via `@mozetto/protocol-vectors`
- Canonical MODEL_POLICY_V1 fields + `modelPolicyHash` matching vector 10
- Groq provider system prompt uses master policy + typed profile axes (no free-text ranked prompts)
- Docs: `docs/WP-071_MASTER_POLICY_PROFILES.md`
- Export: `@mozetto/agent-runtime/policy`

**Season 1 hypotheses (empirical defaults):**
- `temperatureMilli=0`, `maxOutputTokens=256` (frozen vector 10)
- Fox / Professor / Machine axis defaults (Shark frozen to vector 09)
- Axis envelope ±25; shared `allowedSchedulerWeights=0x00ff00ff`

**Not done (by design / other packets):**
- WP-073 continuous cognition loops
- WP-074 Energy ledger
- WP-075 public cadence
- Multi-model selection UI
- Spec / golden vector mutations

**Commands / evidence:**
- `pnpm --filter @mozetto/agent-runtime test` — **30/30 pass**
- `pnpm --filter @mozetto/agent-runtime typecheck` — pass

**Spec clauses:** Plan 08 master policy + presets; `MOZETTO_CONTROLLER_V1` §3–§4; vectors `09_profile_hash.json`, `10_model_policy_groq.json`.

**Follow-up:** WP-072 AgentState store; WP-076 expand fallback; do **not** start WP-073 loops yet.

### 2026-08-07 — WP-072 AgentState store (DONE)

**Status:** `DONE` (typed private store only; no continuous cognition)

**Delivered:**
- `AgentStateV1` + nested structured types (`streetPlan`, opponent/range/timing models, table image, observations, self strategy)
- Season 1 bounds + deterministic prune/eviction (`schemaVersion=1`)
- Persistence interface: `InMemoryAgentStateStore` + `DbAgentStateStoreStub` / SQL schema doc (Plan 19 §022)
- Reconstruction from checkpoint + public events (`reviewFlag` on gap/schema failure)
- Deterministic public-event ingest (0 Energy) for scheduler call surface
- Unit tests: bounds, eviction, round-trip, reconstruct, privacy (no CoT / hole cards)
- Docs: `docs/WP-072_AGENT_STATE_STORE.md`
- Export: `@mozetto/agent-runtime/state`

**Season 1 hypotheses (empirical caps):**
- `MAX_OPPONENT_MODELS=5`, `MAX_RANGE_HYPOTHESES=8`, `MAX_TIMING_MODELS=5`, `MAX_RECENT_OBSERVATIONS=32`
- Eviction: recency → confidence → seat

**Not done (by design / other packets):**
- WP-073 continuous cognition loops / priority queue
- WP-074 Energy ledger charging
- WP-075 public cadence
- Live Supabase migration apply
- Spec / golden vector mutations

**Commands / evidence:**
- `pnpm --filter @mozetto/agent-runtime test` — **47/47 pass**
- `pnpm --filter @mozetto/agent-runtime typecheck` — pass

**Spec clauses:** Plan 09 Agent Brain + pruning; `MOZETTO_CONTROLLER_V1` §7; `MOZETTO_ENERGY_V1` §10 reconstruct path.

**Follow-up:** WP-074 Energy ledger; WP-076 expand fallback; do **not** start WP-073 loops until integration gates.

### 2026-08-07 — WP-074 Energy ledger (DONE)

**Status:** `DONE` (ledger APIs only; no continuous cognition)

**Delivered:**
- Season 1 Energy module: grant 100 / debit / mandatory reserve 12 / expire unused
- Cost table + `ENERGY_POLICY_HASH` (`energy-policy-season1-100-v1`) — debit amounts marked **hypotheses**
- `ENERGY_OP_V1` / `ENERGY_LEDGER_V1` hashing via `@mozetto/protocol-vectors`; vector 11 replay (0+4+6+8 → end 82)
- AgentState hook: `syncEnergyToAgentState` / `applyExpiredLedgerToAgentState`
- Unit tests: golden vector, overspend rejection, reserve protection, cancelled no-charge
- Docs: `docs/WP-074_ENERGY_LEDGER.md`
- Export: `@mozetto/agent-runtime/energy`

**Season 1 hypotheses (cost table):**
- DETERMINISTIC_INGEST=0, LIGHT/TIMING=2, OPPONENT=4, STREET_PLAN=6, MEMORY=3
- STANDARD/DEEP/MAXIMUM final = 8 / 16 / 24

**Not done (by design / other packets):**
- WP-073 continuous cognition loops / priority queue
- WP-075 public cadence
- Ledger DB persistence (Plan 19)
- Spec / golden vector mutations
- `contracts/` changes

**Commands / evidence:**
- `pnpm --filter @mozetto/agent-runtime test` — **74/74 pass**
- Energy module typechecks clean; package `tsc` still reports pre-existing WP-076 test typing issues unrelated to this packet

**Spec clauses:** `MOZETTO_ENERGY_V1` §§3–8, §11–12; Plan 09 Energy ledger + fairness audit; vector `11_energy_ledger_hand.json`.

**Follow-up:** WP-075 public cadence (DONE — see session log); WP-073 scheduler may consume ledger APIs after integration gates — do **not** start WP-073 loops yet.

### 2026-08-07 — WP-075 Public cadence controller (DONE)

**Status:** `DONE` (final/public action cadence only; no continuous cognition)

**Delivered:**
- `PublicCadenceController` + pure `schedulePublicCadence` / `waitForPublicCadence` / `applyPublicCadenceToDecision`
- Season 1 clamp `[0, 15000]` + deadline fit with commit safety pad
- Separates private `providerCompletionMs` from strategic `publicCadenceMs` (never copies RTT into public field)
- Pads wait when decide finishes early; `waitMs=0` when provider already covers cadence
- Unit tests: clamp, deadline fit, delay vs decide latency, injectable sleep
- Docs: `docs/WP-075_PUBLIC_CADENCE_CONTROLLER.md`
- Export: `@mozetto/agent-runtime/cadence`

**Season 1 hypotheses (timing defaults):**
- `PUBLIC_CADENCE_MIN_MS=0`, `PUBLIC_CADENCE_MAX_MS=15000`
- `SEASON1_ACTION_DEADLINE_MS=15000`, `SEASON1_COMMIT_SAFETY_MS=250`
- `SEASON1_CADENCE_SOFT_MAX_MS=12000` (soft guidance)
- Policy label `public-cadence-season1-v1` (recalibrate only via new label/season)

**Not done (by design / other packets):**
- WP-073 continuous cognition loops / priority queue
- Game-server wire of wait-before-broadcast (call surface ready)
- Spec / golden vector mutations
- Profile→cadence model mapping recalibration

**Commands / evidence:**
- `pnpm --filter @mozetto/agent-runtime test` — **99/99 pass**

**Spec clauses:** Plan 09 public timing vs provider latency; `MOZETTO_CONTROLLER_V1` §6 `publicCadenceMs` must fit deadline; raw provider latency not public.

**Follow-up:** WP-077 eval harness (DONE); do **not** start WP-073 until integration gates.

### 2026-08-07 — WP-077 Poker evaluation harness (DONE)

**Status:** `DONE` (offline / CI-safe mock harness; optional live Groq)

**Delivered:**
- Eval module under `services/agent-runtime/src/eval/` — scenarios, `ProfileMockProvider`, metrics, harness, CLI
- Metrics: latency buckets + p50/p95/p99, fallback rate, illegal-action rate, WP-074 Energy spend, rough bb/100 stub, profile separation (action histogram TV distance), VPIP/PFR/aggression proxies
- CI-safe default `--mode mock` (no `GROQ_API_KEY`); `--mode live` optional
- Docs: `docs/WP-077_POKER_EVAL_HARNESS.md`
- Export: `@mozetto/agent-runtime/eval`; root `pnpm eval:poker`

**Not done (by design / other packets):**
- WP-073 continuous cognition scheduler
- Full-session engine EV (bb/100 remains stub)
- Tens-of-thousands live bake-off SLO campaign
- Spec / golden vector mutations

**Commands / evidence:**
- `pnpm --filter @mozetto/agent-runtime test` — pass (includes WP-077 suites)
- `pnpm eval:poker -- --mode mock --quiet` — separated=true, fallbackRate=0, Energy tracked
- `pnpm --filter @mozetto/agent-runtime typecheck` — pass

**Spec clauses:** Plan 08 model bake-off + profile separation tests; Wave 7 AI-only evaluation surface.

**Follow-up:** Live bake-off when needed; do **not** start WP-073 until integration gates.

### 2026-08-07 — WP-020 ArenaAccount/GamePermission review (DONE)

**Status:** `DONE`

**Artifacts:**
- Gap analysis: `docs/WP-020_CUSTODY_GAP_ANALYSIS.md`
- Contracts: `ArenaAccount.sol` (owner revoke, emergency invalidate, two-step ownership), `ArenaAccountFactory.sol` (`syncOwner`), `ArenaVaultV2.sol` (settlement destination + exact-lock guards)
- Tests: `contracts/test/ArenaAccountV2.t.sol` expanded (31 tests)
- Manifest: `packages/chain-manifest/src/index.ts` rejects non-Circle USDC env override on Base mainnet; `mainnet-guard.test.ts` 6/6
- README pointer: `contracts/README.md`

**Commands / evidence:**
- `cd contracts && forge test --match-contract ArenaAccountV2Test` — **31/31 pass**
- `cd contracts && forge test` — **73/73 pass**
- `node --test packages/chain-manifest/src/mainnet-guard.test.ts` — **6/6 pass**

**Compatibility:** Did **not** change `GAME_PERMISSION_TYPEHASH` / `SEAT_TICKET_TYPEHASH` or `GameAuth` layout (Anvil E2E + API positional reads preserved).

**Deferred (documented):** `allowedTemplateSetRoot`, `validAfter`, SeatTicket V3, ProtocolFeeVault — WP-021 / WP-022 / WP-024.

**Follow-up:** WP-021 SeatTicket V3 + atomic funding; WP-024 fee vault.

### 2026-08-07 — WP-021 SeatTicket V3 and atomic funding (DONE)

**Status:** `DONE`

**Artifacts:**
- Vault: `contracts/src/ArenaVaultV2.sol` — `SeatTicketV3`, `SessionDescriptor`, `sealAndFundSession`, ordered Merkle root checks, EIP-712 V3 typehash (domain v2 unchanged)
- Tests: `contracts/test/SeatTicketV3.t.sol` (underfunded atomic, duplicate, wrong template/league/vault/USDC, nonce replay, seal deadline, participant root, EIP-1271, V2 coexistence)
- Migration note: `docs/WP-021_SEAT_TICKET_V3.md`
- TS: `packages/blockchain` `SEAT_TICKET_V3_TYPES` / `seatTicketV3Domain`; `packages/shared-types` Zod V3 + SessionDescriptorV2 schemas
- README pointer: `contracts/README.md`

**Commands / evidence:**
- `cd contracts && forge test --match-contract SeatTicketV3Test` — **14/14 pass**
- `cd contracts && forge test --match-contract ArenaAccountV2Test` — regression check
- `cd contracts && forge test` — full suite

**Compatibility:** V2 `SeatTicket` + `openSession` unchanged; shared `usedNonces`; no frozen `/specs` encoding changes.

**Intentional deltas:** seat = tickets array index; `sealAndFundSession(..., signatures)`; `defaultEmergencyExitDelay`; `uint8 leagueBit` cast to `uint32` for lockBuyIn.

**Follow-up:** WP-022 GameRegistryV2; WP-023 session lifecycle; WP-024 ProtocolFeeVault.

### 2026-08-07 — WP-022 GameRegistryV2 (DONE)

**Status:** `DONE`

**Artifacts:**
- Contract: `contracts/src/GameRegistryV2.sol` — sealed GameTemplateV2 body, timelocked activate/deactivate, emergency deactivate, frozen `DOMAIN_GAME_TEMPLATE_V2` hash
- Tests: `contracts/test/GameRegistryV2.t.sol` (register, activate, deactivate, unauthorized, timelock, immutability, historical hash after deactivation)
- Deploy: `DeployLocal.s.sol` seeds HU + six-max Season 1 templates (`minDelay=0` for Anvil); `TableRegistryV1` unchanged
- Manifest: additive `gameRegistry` field (codegen + `getManifest`)
- Note: `docs/WP-022_GAME_REGISTRY_V2.md`; `contracts/README.md` pointer

**Commands / evidence:**
- `cd contracts && forge test --match-contract GameRegistryV2Test` — **20/20 pass**
- `cd contracts && forge test` — **107/107 pass**
- `pnpm --filter @mozetto/chain-manifest codegen` + mainnet-guard tests

**Compatibility:** V1 `TableRegistryV1` retained; vault/SeatTicket not yet gated on registry (WP-023); no frozen `/specs` changes.

**Follow-up:** WP-023 session lifecycle gates; WP-024 ProtocolFeeVault; WP-093 Safe/timelock owner.

### 2026-08-07 — WP-023 Session lifecycle contract state (DONE)

**Status:** `DONE`

**Artifacts:**
- Contract: `contracts/src/SessionLifecycleV2.sol` — SESSION_V2 states DRAFT→SEALED→RANDOMNESS_PENDING→READY→ACTIVE→SETTLING→SETTLED (+ ABORTED / EMERGENCY_EXIT)
- Vault: `ArenaVaultV2` — optional `gameRegistry` / `sessionLifecycle`; `topUpSession` blocked after V3 seal; seal/settle/emergency hooks
- Tests: `contracts/test/SessionLifecycleV2.t.sol` (happy path, illegal transitions, seal immutability, registry gate, vault coord)
- Deploy: `DeployLocal.s.sol` wires lifecycle ↔ vault ↔ GameRegistryV2
- Manifest: additive `sessionLifecycle` (codegen + `getManifest`)
- Note: `docs/WP-023_SESSION_LIFECYCLE.md`; `contracts/README.md` pointer

**Commands / evidence:**
- `cd contracts && forge test --match-contract SessionLifecycle` — **21/21 pass**
- `cd contracts && forge test` — **128/128 pass**
- `pnpm --filter @mozetto/chain-manifest codegen` + mainnet-guard tests

**Compatibility:** V2 `openSession` unchanged when registry unset; V3 seal notifies lifecycle when configured; no frozen `/specs` or poker-core changes.

**Intentional stubs:** randomness/ready are event+commitment only (Beacon V2 deferred); vault `recordSettled` may fast-forward post-seal stubs.

**Follow-up:** WP-024 ProtocolFeeVault; WP-040+ matchmaking/session orchestration; Beacon/Hub V3.

### 2026-08-07 — WP-030 Freeze TS engine behavior (DONE)

**Status:** `DONE`

**Delivered:**
- Deterministic state hash: `packages/game-rules/src/state-hash.ts` (`MOZETTO_TS_ENGINE_STATE_V1`, build id `mozetto-nlhe-ts-freeze-wp030`)
- Fixture runner + scenario defs: `fixture-runner.ts`, `freeze-fixtures.ts`
- Golden JSON: `packages/game-rules/fixtures/` (19 fixtures + `manifest.json`)
- Drift tests: `src/freeze.test.ts` (fails if behavior or hashes change)
- Freeze note: `docs/WP-030_TS_ENGINE_FREEZE.md`
- Regenerator: `pnpm --filter @mozetto/game-rules generate:fixtures`

**Coverage:** HU blinds/button/legal actions/raises/all-ins/runout/ties/rake; multi incomplete-all-in, side pots, odd chip; six-max blinds/UTG/fold-to-BB. Six-max deep trees / sit-out / timeout / uncalled-bet-return documented as gaps.

**Hash note:** TS state hash is freeze-oracle (stable JSON under TS domain). Protocol V3 `engineHash` remains draft placeholder `mozetto-nlhe-engine-v3-draft` until Rust promotion. Engine not rewritten for V3 event ABI in this packet.

**Commands / evidence:**
- `pnpm --filter @mozetto/game-rules test` — **42/42 pass**
- `pnpm --filter @mozetto/game-rules typecheck` — pass

**Follow-up:** WP-031 Rust HU core against these fixtures; WP-034 differential harness.

### 2026-08-07 — WP-031 Rust HU core (DONE)

**Status:** `DONE`

**Delivered:**
- `crates/poker-eval` — cards + 7-card Hold'em evaluator (TS `hand-rank` port)
- `crates/poker-core` — pure HU NLHE transition (`state + action → state + events`), pots, legal actions, runout, rake (bps), fold-win, showdown
- HMAC-SHA256 shuffle + SHA-256 seed commit matching TS `cards.ts`
- TS freeze-oracle state hash (`MOZETTO_TS_ENGINE_STATE_V1`) for differential parity
- Fixture runner over `packages/game-rules/fixtures/hu_*.json`
- Parity note: `docs/WP-031_RUST_HU_PARITY.md`

**Parity:** **12 / 12** HU fixtures PASS (outcomes + `stateHash` / `legalActionsHash` where asserted). Multi/six-max deferred to WP-032.

**Commands / evidence:**
- `cargo test -p poker-core -p poker-eval` — pass (incl. all HU fixtures)
- `cargo test -p protocol-vectors-rs` — **15/15** (WP-015 unbroken)

**Out of scope (as planned):** six-max (WP-032), WASM (WP-035), PokerKit differential (WP-034), `contracts/` / SeatTicket (WP-021).

**Follow-up:** WP-032 Rust six-max; WP-033 evaluator polish; WP-034 differential harness.

### 2026-08-07 — WP-032 Rust six-max core (DONE)

**Status:** `DONE`

**Delivered:**
- Extended `crates/poker-core` fixture replay to `multi_*` / `sixmax_*` (formats `multi`, `sixmax`)
- `potLayers` expect checks for side-pot fixtures
- Direct six-max unit tests (UTG first act; fold-to-BB)
- Parity note: `docs/WP-032_RUST_SIXMAX_PARITY.md`
- Rust build id `mozetto-nlhe-rust-sixmax-wp032` (not Protocol-promoted)

**Parity:** **7 / 7** multi/six-max fixtures PASS; **12 / 12** HU fixtures still PASS.

**Coverage exercised:** six-max blinds/UTG, fold-to-BB, incomplete all-in no-reopen, three-way + nested side pots, odd chip after button, folded chips in pot.

**Commands / evidence:**
- `cargo test -p poker-core -p poker-eval` — pass (HU + multi/sixmax)
- `cargo test -p protocol-vectors-rs` — **15/15** (WP-015 unbroken)

**Out of scope (as planned):** PokerKit differential (WP-034), WASM (WP-035), evaluator polish (WP-033), `contracts/` edits, spec hash changes.

**Follow-up:** WP-033 hand evaluator; WP-034 differential harness; WP-035 WASM verifier.

### 2026-08-07 — WP-033 Hand evaluator (DONE)

**Status:** `DONE`

**Delivered:**
- Hardened `crates/poker-eval`: public `rank_five`, Protocol V3 `card_code`/`card_from_code`, category snake_case ids
- Shared golden vectors `crates/poker-eval/vectors/hand_eval_v1.json` (5-card categories, kickers, ties, 7-card best-of, holdem compare)
- Rust runner `crates/poker-eval/tests/hand_eval_vectors.rs`
- TS cross-check `packages/game-rules/src/hand-eval-vectors.test.ts` (+ `rankFive`, `cardCode`)
- WP-034 hook constants (`DIFFERENTIAL_ORACLE_ID`) — harness not implemented
- Status note: `docs/WP-033_HAND_EVALUATOR.md`

**Coverage:** high card → royal flush; wheel/broadway; kicker ladders; three-pair best-of; board-plays chop; SF vs quads.

**Commands / evidence:**
- `cargo test -p poker-eval -p poker-core` — pass (vectors + HU/sixmax fixtures)
- `pnpm --filter @mozetto/game-rules test` — **79/79** pass
- `cargo test -p protocol-vectors-rs` — **15/15** (WP-015 unbroken)

**Out of scope (as planned):** PokerKit differential CI (WP-034), WASM (WP-035), `contracts/`, spec hash changes.

**Follow-up:** WP-034 differential oracle harness; WP-035 WASM verifier.

### 2026-08-07 — WP-034 Differential oracle harness (DONE)

**Status:** `DONE`

**Delivered:**
- Harness `tools/engine-diff/` — TS + Rust dumpers, comparator, optional PokerKit probe
- Rust `engine_diff` binary + `dump_fixture_trace` / `dump_stream_trace` in `poker-core`
- Root scripts: `pnpm test:engine-diff`, `:random`, `:full`
- Mismatch report → `tools/engine-diff/out/latest-report.json`
- Status note: `docs/WP-034_DIFFERENTIAL_HARNESS.md`
- PokerKit remains optional (`tools/pokerkit-oracle/`); skipped when deps missing

**Parity:** **19 / 19** WP-030 fixtures TS↔Rust matched; **25 / 25** random streams (seed 42) matched. **Zero unexplained TS↔Rust mismatches.** PokerKit: skipped (not installed in this env) — documented policy gaps only.

**Commands / evidence:**
- `pnpm test:engine-diff` — PASS
- `pnpm test:engine-diff:random` — PASS
- `cargo test -p poker-core -p protocol-vectors-rs` — pass (**15/15** WP-015 unbroken)

**Out of scope (as planned):** WASM (WP-035), claiming Wave 3 complete (WP-035 remains), `contracts/`, spec hash changes.

**Follow-up:** WP-035 WASM verifier. Wave 3 gate (unexplained differential = 0) satisfied for TS↔Rust; full Wave 3 still needs WP-035.

### 2026-08-07 — WP-035 WASM replay verifier (DONE)

**Status:** `DONE` — Wave 3 poker core complete

**Delivered:**
- `crates/poker-wasm` — wasm-bindgen exports `verify_fixture` / `verify_fixtures` → stacks + state hashes
- `crates/poker-replay` — native CLI companion (`verify` dir/file)
- `poker-core::run_fixture_json` / `verify_fixture_json` (no filesystem; WASM-safe)
- Build: `scripts/build-poker-wasm.sh` → `tools/poker-wasm/pkg/`
- Node acceptance: `tools/poker-wasm/verify-fixtures.mjs`
- Root scripts: `pnpm build:poker-wasm`, `pnpm test:poker-wasm`, `pnpm test:poker-replay`
- Docs: `docs/WP-035_WASM_VERIFIER.md`
- CI: native CLI fixture verify in protocol-vectors job

**Parity:** WASM and CLI both **19 / 19** WP-030 fixtures. Prior packets remain green (HU/sixmax, WP-015, WP-034 engine-diff).

**Commands / evidence:**
- `pnpm build:poker-wasm && pnpm test:poker-wasm` — PASS (19/19)
- `pnpm test:poker-replay` — PASS (19/19)
- `cargo test -p poker-core -p poker-eval -p poker-wasm -p protocol-vectors-rs` — pass
- `pnpm test:engine-diff` — PASS

**Out of scope (as planned):** dealer TEE / continuous Groq, `contracts/` (WP-023), spec hash mutations.

**Wave 3 gate:** met — zero unexplained TS↔Rust differentials (WP-034) + WASM/CLI public replay verifier (WP-035).

### 2026-08-07 — WP-040 Ranked random matchmaker (DONE)

**Status:** `DONE`

**Delivered:**
- Pure allocator `packages/database/src/ranked-matchmaker.ts` — same-pool filter, HU pair caps, uniform random pick, seat permutation
- Evolved `findArenaMatch` — no fullest-first; writes `matchmaking_allocation_log`
- On-chain `claimTicketPair` / `claimOpenOnchainSession` — `ORDER BY random()` within pool
- Migration `017_matchmaking_allocation_audit.sql`
- Tests `packages/database/src/matchmaking.test.ts` (pool / pair-cap / random)
- Docs `docs/WP-040_RANKED_RANDOM_MATCHMAKER.md` (ranked vs private/open-table)

**Commands / evidence:**
- `pnpm --filter @mozetto/database test` — **14/14** pass
- `pnpm --filter @mozetto/database typecheck` — pass

**Out of scope:** rating-band wait expansion, linked-identity clusters (WP-043), seal coordinator (WP-041), `/v1/matchmaking/intents` API, spec changes, continuous cognition.

**Follow-up:** WP-041 consume `seat_order` at seal (DONE); WP-042 epoch join/leave; WP-043 anti-pairing hooks.

### 2026-08-07 — WP-041 Session seal coordinator (DONE)

**Status:** `DONE`

**Delivered:**
- Package `@mozetto/session-seal` — SESSION_V2 commitment builder + seal coordinator
- `applySeatOrder` consumes WP-040 `seat_order` → `tickets[i] ≡ seat i`
- Roots: participant / opening / controller / profile + `sessionId` / descriptor hash (Protocol V3 Merkle)
- Dry-run calldata + submit via pluggable `VaultSealClient` (mocked in tests; Anvil-ready)
- ABI: `SEAL_AND_FUND_SESSION_ABI` in session-seal + mirrored on `arenaVaultV2Abi` (no `ArenaVaultV2.sol` edits)
- Docs: `docs/WP-041_SESSION_SEAL_COORDINATOR.md`

**Commands / evidence:**
- `pnpm --filter @mozetto/session-seal test` — **8/8** pass (golden `01_session_hu` roots + mocked vault)
- `pnpm --filter @mozetto/session-seal typecheck` — pass

**Out of scope:** ArenaVault / fee-vault contract edits (WP-024), epoch join/leave (WP-042), anti-pairing (WP-043), HTTP `/internal/sessions/:id/seal` wire, spec mutations, continuous Groq.

**Follow-up:** API internal seal route; Anvil E2E relayer submit; WP-042 epoch rotation.

### 2026-08-07 — WP-042 Epoch join/leave rotation (DONE)

**Status:** `DONE`

**Delivered:**
- Migration `018_epoch_join_leave.sql` — `table_epochs` + `queued_seat_changes`
- Pure planner `packages/database/src/epoch-rotation.ts` — mid-hand immutability, leave→top-up→join order
- DB helpers `packages/database/src/epoch-store.ts` — enqueue + rotate at boundary
- Game-server: mid-hand join/leave/top-up queue; flush after hand complete / fold-win; `EPOCH_ROTATED` event
- Docs `docs/WP-042_EPOCH_JOIN_LEAVE.md`

**Commands / evidence:**
- `pnpm --filter @mozetto/database test` — **37/37** pass (includes WP-040/042/043)
- `pnpm --filter @mozetto/database typecheck` — pass
- `pnpm --filter @mozetto/game-server typecheck` — pass

**Out of scope:** on-chain Epoch N+1 reseal (WP-025 / seal follow-up), spec mutations, continuous cognition.

**Follow-up:** session-seal dry-run at epoch boundary; optional cancel-pending; apply WP-043 integrity on queued joins.

### 2026-08-07 — WP-076 Deterministic fallback (DONE)

**Status:** `DONE` (auditable legal-action fallback only; no continuous cognition)

**Delivered:**
- Hardened `DeterministicFallbackController` with frozen priority: check → call → fold → sized (BET→RAISE→ALL_IN @ minAmount)
- Policy id/version: `deterministic-fallback-v1` / `1` (MODEL_POLICY_V1 `fallbackPolicyHash` label)
- Audit fields: `fallbackPolicyId`, `fallbackPolicyVersion`, `fallbackPriorityStep`, `fallbackSelectionReasonCode`
- Groq `finishFallback` remaps top-level `reasonCode` to PROVIDER/ILLEGAL but preserves selection reason + policy stamps
- Default wire unchanged: Groq uses `DeterministicFallbackController` when not injected
- HU + multi legal-set tests; docs: `docs/WP-076_DETERMINISTIC_FALLBACK.md`

**Not done (by design / other packets):**
- WP-073 continuous cognition scheduler
- WP-074 Energy ledger (completed separately — see session log)
- WP-075 public cadence (DONE — `@mozetto/agent-runtime/cadence`; fallback still emits `0`)
- Softened “almost legal” repair beyond existing Groq schema-repair pass
- Spec / golden vector mutations

**Commands / evidence:**
- `pnpm --filter @mozetto/agent-runtime test` — pass (includes fallback suites)
- Docs: `docs/WP-076_DETERMINISTIC_FALLBACK.md`

**Spec clauses:** Plan 08 degraded path; CONTROLLER_V1 fallback; ENERGY_V1 §10 fallback + review.

**Follow-up:** WP-075 cadence (DONE); WP-077 eval harness (DONE); do **not** start WP-073 until integration gates.

### 2026-08-07 — WP-024 ProtocolFeeVault + settlement destinations (DONE)

**Status:** `DONE`

**Artifacts:**
- Contract: `contracts/src/ProtocolFeeVault.sol` — fee-only accrual; authorized depositors; owner sweep → Treasury Safe; timelocked treasury updates; guardian pause without sweep
- Vault: `ArenaVaultV2` — `withdrawProtocolFees` deposits into ProtocolFeeVault (period/root overload); player payouts remain sealed ArenaAccounts only
- Tests: `contracts/test/ProtocolFeeVault.t.sol` (deposit auth, guardian cannot sweep, pause/deposit, treasury timelock, settlement destinations, fee failure does not block settle)
- Deploy: `DeployLocal.s.sol` / `DeploySepolia.s.sol` wire fee vault as vault `feeTreasury`; manifest `feeTreasury` = ultimate Safe
- Manifest: additive `protocolFeeVault` (codegen + `getManifest`)
- Note: `docs/WP-024_PROTOCOL_FEE_VAULT.md`; `contracts/README.md` pointer

**Commands / evidence:**
- `cd contracts && forge test --match-contract ProtocolFeeVault` — **15/15 pass**
- `cd contracts && forge test` — **143/143 pass**
- `pnpm --filter @mozetto/chain-manifest codegen` + mainnet-guard tests — **6/6 pass**

**Compatibility:** SettlementHubV2 / frozen SETTLEMENT_V3 encodings untouched; V1 vault still sweeps to treasury EOA; no poker-core / game-rules changes.

**Intentional deferrals:** SettlementHubV3 (WP-063); production Safe owner + long timelock (WP-093); worker auto-`sweep` to Treasury Safe.

**Follow-up:** WP-025 contract invariants (DONE); WP-063 SettlementHubV3; WP-093 Safe/timelock ownership.

### 2026-08-07 — WP-025 Contract invariants (DONE)

**Status:** `DONE` — Wave 2 custody gate green

**Artifacts:**
- Handler: `contracts/test/invariant/CustodyHandler.sol` — bounded open/seal/settle/fee/sweep + adversarial redirect/over-cap/post-seal paths
- Suite: `contracts/test/invariant/CustodyInvariants.t.sol` — 8 invariants (vault solvency equality, fee vault accrual, ArenaAccount-only locks, post-seal immutability, permission caps, adversarial ghosts)
- Config: `contracts/foundry.toml` `[invariant] runs = 256`, `depth = 32`, `fail_on_revert = false`
- Note: `docs/WP-025_CONTRACT_INVARIANTS.md`; `contracts/README.md` pointer
- **Contract patches:** none for custody contracts. Incidental: ASCII-only strings in `script/MockVrfAnvil.s.sol` (Unicode em-dash broke `forge test` compile)

**Commands / evidence:**
- `cd contracts && forge test --match-contract CustodyInvariantsTest` — **8/8 pass** (runs: **256**, calls: 8192)
- `cd contracts && FOUNDRY_INVARIANT_RUNS=1000 forge test --match-contract CustodyInvariantsTest` — **8/8 pass** (runs: **1000**, calls: 32000, reverts: 0)

**Agreed run count:** 256 (CI default). Extended 1000 documented as additional evidence.

**Out of scope:** emergency-exit merkle fuzz; SettlementHubV2 attestor quorum path (handler = compromised settlement hub); MockUSDC donations to vault; spec / poker-core / agent-runtime edits.

**Follow-up:** WP-063 SettlementHubV3; indexer reconciliation against same solvency equality; optional CI job with `FOUNDRY_INVARIANT_RUNS=1000`.

### 2026-08-07 — WP-043 Anti-pairing and identity hooks (DONE)

**Status:** `DONE`

**Delivered:**
- `LinkedAccountLookup` + `StubLinkedAccountStore` (`packages/database/src/linked-accounts.ts`)
- Opponent integrity order: self → linked → HU pair cap (`evaluateOpponentIntegrity` / filter)
- `pairRatingWeight` aligned with Plan 12 bands; used by `repeatedOpponentWeight`
- Wired into `findArenaMatch`, `claimTicketPair`, `claimOpenOnchainSession`
- Pre-seal `assertRankedParticipantIntegrity` (coordinates with WP-023/041 freeze)
- Docs: `docs/WP-043_ANTI_PAIRING.md`

**Commands / evidence:**
- `pnpm --filter @mozetto/database test` — **37/37** pass (includes WP-043 suite)
- `pnpm --filter @mozetto/database typecheck` — pass

**Out of scope:** collusion ML, persistent link DB table, contracts (WP-025), agent-runtime (WP-074/076), spec mutations.

**Follow-up:** persist link edges + admin review; rating-band wait expansion.

### 2026-08-07 — WP-050 RandomnessBeaconV2 contract (DONE)

**Status:** `DONE`

**Artifacts:**
- Contract: `contracts/src/RandomnessBeaconV2.sol` — commit secret root → request VRF → fulfill → register deck batch; no reroll/shopping; no raw cards/secrets
- Tests: `contracts/test/RandomnessBeaconV2.t.sol` (happy path + mutation/reroll rejection + mock gate)
- Deploy: `DeployLocal.s.sol` (mock VRF on); `DeploySepolia.s.sol` (mock off unless `ENABLE_MOCK_VRF=1`)
- Manifest: additive `randomnessBeacon` (codegen + `getManifest`); V1 coordinator retained
- Note: `docs/WP-050_RANDOMNESS_BEACON_V2.md`; `contracts/README.md` pointer

**Commands / evidence:**
- `cd contracts && forge test --match-contract RandomnessBeaconV2` — **19/19 pass**
- `cd contracts && forge test` — **169/169 pass**
- `pnpm --filter @mozetto/chain-manifest codegen` + mainnet-guard tests — **6/6 pass**

**Compatibility:** `RandomnessCoordinatorV1` unchanged; SessionLifecycle WP-023 stubs untouched; frozen `/specs` untouched; no enclave / agent-runtime changes.

**Intentional deferrals:** Chainlink adapter (WP-053); Nitro Enclave (WP-054); lifecycle↔beacon direct coupling. (WP-051 deck + WP-052 Anvil mock VRF completed after this note.)

**Follow-up:** WP-051–052 DONE; WP-053–055 Wave 5 remainder.

### 2026-08-07 — WP-051 Dealer deterministic deck library (DONE)

**Status:** `DONE`

**Delivered:**
- Package `@mozetto/dealer-deck`: Season-1 handSeed, CSPRNG stream, rejection-sampled Fisher–Yates, production/fixture card salts, card leaves, deckRoot proofs, secret/dealer roots, deckBatchRoot + bind
- Tests vs golden vectors 07/08 + mutation failures (secret replace, VRF-only seed, flipped cardCode, wrong proof position, duplicate codes, rejection redraw)
- Dealer service wire: V2 secret leaves + handSeed; `POST /v1/dealer/prepare-deck`, `POST /v1/dealer/open-public-card`
- Docs: `docs/WP-051_DEALER_DECK_LIBRARY.md`

**Commands / evidence:**
- `pnpm --filter @mozetto/dealer-deck test` — **14/14 pass**
- `pnpm --filter @mozetto/dealer-deck typecheck` — pass

**Out of scope:** RandomnessBeaconV2 (WP-050), Nitro Enclave (WP-054), Rust twin, live engine HMAC shuffle cutover, spec mutations.

**Follow-up:** WP-052 Mock VRF Anvil (**DONE**); WP-055 verifier CLI can consume this library.

### 2026-08-07 — WP-052 Mock VRF Anvil integration (DONE)

**Status:** `DONE`

**Artifacts:**
- Foundry script: `contracts/script/MockVrfAnvil.s.sol` — commit → request → fulfillMock → registerDeckBatch (deterministic fixtures)
- Node E2E: `scripts/anvil-mock-vrf-beacon.mjs` (+ optional `--with-deck` via `@mozetto/dealer-deck`)
- Orchestrator: `scripts/anvil-mock-vrf.sh`; `pnpm e2e:mock-vrf` / `pnpm e2e:mock-vrf:forge`
- Docs: `docs/WP-052_MOCK_VRF_ANVIL.md` (dealer/service consumption); `contracts/README.md` pointer
- DeployLocal comment + `start-local.sh` syncs `RANDOMNESS_BEACON_ADDRESS`

**Commands / evidence:**
- `bash scripts/anvil-mock-vrf.sh` / `forge script script/MockVrfAnvil.s.sol --broadcast` — commit → mock fulfill → deck batch on Anvil
- `pnpm e2e:mock-vrf -- --deploy-beacon` (fixture roots) and `--with-deck` (dealer-deck bind match)
- `cd contracts && forge test --match-contract RandomnessBeaconV2` — **19/19** (WP-050 no-reroll gate)

**Compatibility:** No `/specs` mutations; no Chainlink (WP-053); no enclave (WP-054); does not edit WP-025 invariant or WP-051 library sources.

**Follow-up:** WP-053 Chainlink; settlement-worker V1→Beacon V2 migration; WP-055 verifier CLI (**DONE**).

### 2026-08-07 — WP-055 Randomness verifier CLI (DONE)

**Status:** `DONE`

**Delivered:**
- Package `@mozetto/randomness-verifier` — independent CLI + library consuming `@mozetto/dealer-deck`
- Golden vectors 07/08: secret leaves, `dealerSecretRoot`, `handSeed0`, `deckRoot`, Merkle proof, public opening
- Mutation suite: replaced secret, VRF-only seed, flipped cardCode, wrong proof position, duplicate codes, wrong salt
- Root script: `pnpm verify:randomness`; optional `--opening` / `--json`
- Docs: `docs/WP-055_RANDOMNESS_VERIFIER.md`

**Commands / evidence:**
- `pnpm verify:randomness` — all checks PASS
- `pnpm --filter @mozetto/randomness-verifier test` — pass
- `pnpm --filter @mozetto/randomness-verifier typecheck` — pass

**Out of scope:** Chainlink (WP-053), Nitro Enclave (WP-054), contracts/beacon edits, spec mutations, Rust twin.

**Follow-up:** WP-053 Chainlink adapter (**DONE**); WP-054 enclave; WP-090 public verify page can reuse this CLI/library.

### 2026-08-07 — WP-073 Continuous cognition scheduler (DONE)

**Status:** `DONE`

**Delivered:**
- Cognitive scheduler module `services/agent-runtime/src/cognition/` — priority queue, ENERGY_V1 §6 mode policy, event-driven `onPublicEvent` / `drain` / `preemptForFinalAction` / `runFinalAction`
- Groq provider `updateState` wired for real background path (strict `background_state_patch_v1` JSON Schema; AbortSignal cancel; stub kind remains no-op)
- Energy: background debits only after successful execution; reserve (≥12) gated; cancelled/preempted = no debit; finals may spend into reserve
- Structured AgentState patches only — never raw CoT storage/broadcast
- Unit tests: policy mapping, queue order, reserve gate, preempt no-debit, final action, mocked Groq HTTP
- Docs: `docs/WP-073_CONTINUOUS_COGNITION.md`
- Export: `@mozetto/agent-runtime/cognition`

**Season 1 hypotheses (scheduler weights + Energy):**
- Policy label `continuous-cognition-scheduler-season1-v1`
- Mode thresholds / priority boosts / `UNUSUAL_CADENCE_MS=11000` — not proven optima
- `DEEP_REEVALUATION` charges STREET_PLAN (6); Energy cost table remains WP-074 hypotheses

**Not done (by design / other packets):**
- Spec / golden vector mutations
- `contracts/` changes
- Game-server wire of wait-before-broadcast + live AI seat loop (call surface ready)
- Cognition job DB persistence

**Commands / evidence:**
- `pnpm --filter @mozetto/agent-runtime test` — **115/115 pass**
- `pnpm --filter @mozetto/agent-runtime typecheck` — pass

**Spec clauses:** Plan 09 continuous cognition + Energy + timing; `MOZETTO_ENERGY_V1` §§4–6, §12; `MOZETTO_CONTROLLER_V1` §7; D-006.

**Follow-up:** Wire scheduler into game-server AI seats; live bake-off under load (Wave 7 gate remaining product integration).

### 2026-08-07 — WP-064 Replay verifier service (DONE)

**Status:** `DONE`

**Delivered:**
- TS service upgrade: `services/replay-verifier` verifies `poker_event_v1` (ABI via `@mozetto/event-store`) **and** `legacy_json` (GENESIS keccak)
- Settlement proposal gate: `eventRoot` / `finalSequence` must match chain tip; divergent proposals rejected
- Offline `POST /v1/verify-transcript` (no DB) + DB-backed `POST /v1/verify-session`
- Rust CLI: `poker-replay verify-events` (+ `--golden 03|04`); WP-035 fixture `verify` unchanged
- Docs: `docs/WP-064_REPLAY_VERIFIER.md`
- Root scripts: `pnpm test:poker-replay:events`; CI includes `@mozetto/replay-verifier` test/typecheck

**Commands / evidence:**
- `pnpm --filter @mozetto/replay-verifier test` — **8/8 pass**
- `pnpm --filter @mozetto/replay-verifier typecheck` — pass
- `cargo test -p poker-replay` — **5/5 pass**
- `cargo run -q -p poker-replay -- verify-events --golden 03` / `04` — ok
- `pnpm test:poker-replay` — WP-035 fixtures still green

**Out of scope:** SettlementHub contract ownership (WP-063 DONE elsewhere); HandRoot rebuild in service (WP-061); attestor key topology split (WP-065 package exists — wire follow-up); full PokerEventV1→engine action replay (fixtures remain WP-035 path).

**Follow-up:** Wire replay attestor via `@mozetto/attestors`; WP-066 emergency exit; WP-084 settlement worker consume verified tips.

### 2026-08-07 — WP-081 Persist-before-broadcast outbox (DONE)

**Status:** `DONE`

**Delivered:**
- Outbox pipeline in `services/game-server/src/outbox/` — write → outbox pending → commit → WS broadcast → mark published
- DB helpers `packages/database/src/outbox.ts` + `withTransaction`; migration `020_broadcast_outbox_wp081.sql` (payload/channel/schema_kind + `broadcast_outbox` view)
- Restart recovery: `recoverUndeliveredOutbox` drained from `TableRuntime.load`
- `@mozetto/event-store` bridge (opt-in `CANONICAL_SCHEMA_KIND=poker_event_v1`); default `legacy_json` with clear flags
- `TableRuntime.persistEvent` transactional wire
- Docs: `docs/WP-081_PERSIST_OUTBOX.md`

**Commands / evidence:**
- `pnpm --filter @mozetto/game-server test` — **22/22** pass (WP-080 lease + WP-081 outbox)
- `pnpm --filter @mozetto/game-server typecheck` — pass
- `pnpm --filter @mozetto/database typecheck` — pass

**Out of scope:** SettlementHubV3, full PokerEventV1 cutover (opt-in exists), spec mutations.

**Follow-up:** WP-064 replay on PokerEventV1 (**DONE**); WP-082 chain indexer; multi-replica outbox chaos under Redis.

### 2026-08-07 — WP-060 Canonical event store/hash chain (DONE)

**Status:** `DONE`

**Delivered:**
- Package `@mozetto/event-store` — append-only `EventHashChain` with PokerEventV1 ABI hashing via `@mozetto/protocol-vectors`
- Chain linkage: `previousEventHash` tip continuity; `verify()` / `fromStored` / `verifyEventHashChain`
- Payload helpers: action / blind / street public payload hashes
- Migration stub `019_canonical_poker_events_v1.sql` — Plan 19 columns (`canonical_bytes`, `resulting_state_hash`, epoch fields) + companion tables
- Docs: `docs/WP-060_EVENT_HASH_CHAIN.md`

**Commands / evidence:**
- `pnpm --filter @mozetto/event-store test` — **10/10** pass (vectors 03–04 + integrity/mutations)
- `pnpm --filter @mozetto/event-store typecheck` — pass

**Out of scope:** SettlementHubV3 (WP-063), HandRoot/BalanceRoot (WP-061), ProofBatchRegistry (WP-062), game-server cutover from legacy JSON keccak, RandomnessBeacon / custody edits, spec mutations.

**Follow-up:** WP-061 root builders (DONE); WP-064 replay on PokerEventV1; WP-081 persist-before-broadcast using `schema_kind=poker_event_v1`.

### 2026-08-07 — WP-061 Hand/balance root builder (DONE)

**Status:** `DONE`

**Delivered:**
- Package `@mozetto/root-builder` — balance roots (seat-ordered Merkle), HandRoot encode, proof-batch globalRoot/hash, FinalSettlementV3 EIP-712 + conservation
- Emergency-exit Merkle proof generate/verify (`balanceProofForSeat` / `verifyBalanceInclusion`)
- Event tip from WP-060 `EventHashChain` or plain event/hash arrays (`buildHandRootFromEvents`)
- Low-level `handRoot` + `randomnessEpochId` added to `@mozetto/protocol-vectors`
- Docs: `docs/WP-061_HAND_BALANCE_ROOTS.md`
- Root CI: `test:unit` / `typecheck:ci` include `@mozetto/root-builder`

**Commands / evidence:**
- `pnpm --filter @mozetto/root-builder test` — **11/11 pass** (vectors 05, 12–14 + hand/event-store)
- `pnpm --filter @mozetto/root-builder typecheck` — pass

**Spec clauses:** `MOZETTO_SETTLEMENT_V3` §§3–6, §8; `MOZETTO_PROOF_BATCH_V1` §§3–4, §7; Plan 10 Merkle hierarchy.

**Out of scope:** SettlementHubV3 (WP-063), ProofBatchRegistry (WP-062), emergency-exit contracts (WP-066), spec/vector mutations, Chainlink fights.

**Follow-up:** Settlement worker / replay verifier consume `@mozetto/root-builder`; WP-062 registry anchors `globalRoot`.

### 2026-08-07 — WP-062 ProofBatchRegistryV1 (DONE)

**Status:** `DONE`

**Artifacts:**
- Contract: `contracts/src/ProofBatchRegistryV1.sol` — sequence +1 continuity, prior `globalRoot` link, duplicate-root rejection, authorized publisher, timelocked publisher replace; stores struct + `proofBatchHash`
- Tests: `contracts/test/ProofBatchRegistryV1.t.sol` — domain/vector-13 digests + Merkle leaf-order mutation + continuity/auth/timelock rejections
- Deploy: `DeployLocal.s.sol` (publisher=deployer, minDelay=0); `DeploySepolia.s.sol` (default 1d delay)
- Publisher stub: `script/PublishProofBatchAnvil.s.sol` + `pnpm e2e:proof-batch`
- Manifest: additive `proofBatchRegistry` (codegen + `getManifest` env override)
- Note: `docs/WP-062_PROOF_BATCH_REGISTRY.md`; `contracts/README.md` pointer

**Commands / evidence:**
- `cd contracts && forge test --match-contract ProofBatchRegistryV1` — **17/17 pass**
- `pnpm --filter @mozetto/chain-manifest codegen` + mainnet-guard tests — **6/6 pass**

**Compatibility:** Frozen `/specs` untouched; `CheckpointRegistryV1` retained; Hub V3 gate via `isSequenceAccepted` (WP-063); no full publisher worker (WP-085).

**Intentional deferrals:** Continuous proof-batch publisher (WP-085); emergency exit (WP-066); watchtower permissionless validation.

**Follow-up:** WP-063 SettlementHubV3 (**DONE**); WP-084/085 settlement + publisher workers.

### 2026-08-07 — WP-063 VerifierRouter / SettlementHubV3 (DONE)

**Status:** `DONE`

**Artifacts:**
- `ISettlementVerifier`, `SignatureQuorumVerifier`, `VerifierRouter`, `PokerSettlementHubV3`, `IProofBatchSequenceGate`
- EIP-712 `MozettoPokerSettlement` version `"3"` / FinalSettlementV3 (vector 12 typehash + digest)
- Quorum settle → `ArenaVaultV2.applyCheckpoint` + `settleSession` (sealed ArenaAccount destinations)
- Optional WP-062 gate: `ProofBatchRegistryV1.isSequenceAccepted` (`requireProofBatch` off by default)
- Tests: happy path + mutated roots/rake/balances/signatures/domain/reuse/deadline/destinations
- Deploy: `DeployLocal` / `DeploySepolia` additive Hub V3; V2 remains vault hub unless `SETTLEMENT_HUB_V3_AS_PRIMARY=1`
- Manifest: `settlementHubV3`, `verifierRouter`, `signatureQuorumVerifier`, `settlementHubV2`
- Note: `docs/WP-063_SETTLEMENT_HUB_V3.md`; `contracts/README.md` pointer

**Commands / evidence:**
- `cd contracts && forge test --match-contract PokerSettlementHubV3` — **21/21 pass**
- `cd contracts && forge test --match-contract ProofBatchRegistryV1` — **17/17 pass** (WP-062 + `isSequenceAccepted`)
- `pnpm --filter @mozetto/chain-manifest codegen` + mainnet-guard tests — **6/6 pass**

**Compatibility:** Hub V2 untouched (default demo hub); frozen `/specs` untouched; no ZK proofs; no agent-runtime / dealer-deck edits.

**Intentional deferrals:** Full ZK verifier; enabling `requireProofBatch` by default; WP-066 emergency exit V3; 3-of-5 Sepolia attestor set.

**Follow-up:** WP-064 replay verifier (**DONE**); WP-084 settlement worker V3 (consume `@mozetto/attestors`).

### 2026-08-07 — WP-065 Attestor services (DONE)

**Status:** `DONE`

**Delivered:**
- Package `@mozetto/attestors` — role-separated `game` / `dealer` / `replay` key load + FinalSettlementV3 EIP-712 signing
- Production distinct-key enforcement (`IDENTICAL_KEYS` / addresses); never falls back to `SETTLEMENT_PRIVATE_KEY`
- Quorum helpers + ECDSA recover against vector-12 digests (`@mozetto/root-builder`)
- Settlement-worker light wire: `probeAttestorKeys` + game attest via `tryLoadAttestorKey('game')`
- Docs: `docs/WP-065_ATTESTOR_SERVICES.md`; CI `test:unit` / `typecheck:ci` include package

**Commands / evidence:**
- `pnpm --filter @mozetto/attestors test` — **12/12 pass** (vector 12 + distinct-key)
- `pnpm --filter @mozetto/attestors typecheck` — pass
- Root CI: `test:unit` / `typecheck:ci` include `@mozetto/attestors`

**Out of scope:** Spec mutations; collapsing three roles into one key; full V3 hub settle cutover (WP-084); dealer/replay HTTP services still on V2 typed data until follow-up.

**Follow-up:** WP-084 settlement worker V3; dealer + replay-verifier switch to `@mozetto/attestors`; separate process boundaries per role.

### 2026-08-07 — WP-053 Chainlink VRF adapter (DONE)

**Status:** `DONE`

**Artifacts:**
- Adapter: `contracts/src/ChainlinkVrfAdapterV1.sol` — VRF v2.5 request → track → `rawFulfillRandomWords` → `RandomnessBeaconV2.fulfillVrf`
- Minimal interfaces / encoding: `contracts/src/vrf/` (`IVRFCoordinatorV2Plus`, `VRFV2PlusClient`, consumer iface)
- Mock coordinator: `contracts/src/vrf/MockVRFCoordinatorV2Plus.sol` (unit tests; no live keys)
- Tests: `contracts/test/ChainlinkVrfAdapterV1.t.sol` (happy path, re-request/double-fulfill rejection, coordinator gate)
- Deploy: `contracts/script/DeployChainlinkVrfAdapter.s.sol` (Sepolia; leaves WP-052 Anvil mock untouched)
- Manifest: corrected Base Sepolia coordinator + key hash; additive `chainlinkVrfAdapter`; env `CHAINLINK_VRF_ADAPTER_ADDRESS`
- Docs: `docs/WP-053_CHAINLINK_VRF.md`; `contracts/README.md` + `.env.example` notes

**Commands / evidence:**
- `cd contracts && forge test --match-contract ChainlinkVrfAdapterV1` — **13/13 pass**
- `cd contracts && forge test --match-contract RandomnessBeaconV2` — **19/19 pass** (no regression)
- `pnpm --filter @mozetto/chain-manifest codegen` + mainnet-guard tests — **6/6 pass**

**Compatibility:** No `/specs` mutations; no Nitro Enclave (WP-054); WP-052 mock Anvil scripts untouched; beacon API unchanged.

**Follow-up:** Wire ops/settlement-worker to adapter on Sepolia; WP-054 Nitro Enclave dealer.

### 2026-08-07 — WP-066 Emergency exit (DONE)

**Status:** `DONE`

**Artifacts:**
- Vault: `ArenaVaultV2.emergencyExitWithBalanceLeaf` — `DOMAIN_BALANCE_LEAF_V1` + ordered Merkle (`siblingIsLeft`); `emergencyExitClaimed` one-claim; checkpoint sequence bind
- Additive: legacy `emergencyExit` retained (packed leaf + sorted Merkle); shared ready/payout helpers
- Hub: `PokerSettlementHubV3.emergencyReleaseWithBalanceLeaf`
- Tests: `contracts/test/EmergencyExitV3.t.sol` (+ ProtocolFeeVault fee-vault reject on V3 path)
- Docs: `docs/WP-066_EMERGENCY_EXIT.md`; `contracts/README.md` pointer

**Commands / evidence:**
- `cd contracts && forge test --match-contract EmergencyExitV3Test` — **12/12 pass**
- `cd contracts && forge test --match-contract ProtocolFeeVault` — **16/16 pass**
- `cd contracts && forge test --match-contract 'PokerSettlementHubV3|ArenaAccountV2|SeatTicketV3|SessionLifecycleV2'` — **83/83 pass** (no settle regression)

**Spec clauses:** `MOZETTO_SETTLEMENT_V3` §3 (leaf), §8 (emergency); vector `14_emergency_exit_balance_leaf.json`; Plan 10 emergency exit constraints.

**Compatibility:** Frozen `/specs` untouched; normal `settleSession` happy path unchanged; claimed liability excluded via reduced `lockedBySession` exact-lock settle.

**Known limitations:** `currentBalance` must be ≤ per-player lock (winnings above lock need normal settle); `whenNotPaused` still gates exit.

**Follow-up:** Settlement/watchtower workers submit `@mozetto/root-builder` proofs; optional pause exception for emergency claims.

### 2026-08-07 — WP-086 Hosted deployment recipes (DONE)

**Status:** `DONE`

**Delivered:**
- Recipes for long-lived services (api/game/dealer/verifier/indexer/worker/agent), not only Vercel web
- Extended `render.yaml` Blueprint; `docker-compose.hosted.yml`; Fly configs in `deploy/fly/`
- Dockerfiles: `Dockerfile.{dealer,verifier,worker,agent}` + game/indexer fixes (`@mozetto/dealer` COPY, health EXPOSE/`PORT`)
- Hosted-friendly `start` scripts (no `.env.local`); `PORT` bind for dealer/verifier/agent/indexer; settlement-worker `/health`
- Env checklists + restart/divergence gate notes
- Docs: `docs/WP-086_HOSTED_DEPLOYMENT.md`; README Deploy pointer; `.env.example` hosted notes

**Commands / evidence:**
- Artifact review: Dockerfiles + `render.yaml` + `docker-compose.hosted.yml` + `deploy/fly/*.toml` present
- Live deploy **not** required / not executed (packet scope)
- Docker image build dry-run optional when daemon available

**Out of scope:** Spec mutations; live Render/Fly/Vercel deploy; WP-085 publisher container (library has `start` path — wire when ops wants a separate process); WP-101 chaos automation.

**Follow-up:** Staging Blueprint smoke + controlled component restarts; WP-083/084 workers on same recipes; private networking for dealer/verifier/agent.

### 2026-08-07 — WP-083 Reconciliation worker (DONE)

**Status:** `DONE`

**Delivered:**
- Package `@mozetto/reconciliation` — Plan 03 solvency compare (`vault USDC == open-session locked + accruedProtocolFees`), ProtocolFeeVault coverage, pause signal builders, persist ports
- Worker `services/reconciliation-worker` — poll / `--once`, health `:4012`, auto-pause via `feature_flags.onchain_matchmaking` + `security_incidents`
- Indexer hook: `services/chain-indexer/src/tick.ts` uses shared `runReconciliation` (replaces legacy vault↔ledger float compare)
- Migration `021_reconciliation_wp083.sql` — `reconciliation_differences`
- Mocked-balance tests (no RPC); docs `docs/WP-083_RECONCILIATION_WORKER.md` (ops pause/resume)
- Compatible with WP-091 serializers / solvency dashboard

**Commands / evidence:**
- `pnpm --filter @mozetto/reconciliation test` — **18/18 pass**
- `pnpm --filter @mozetto/reconciliation typecheck` — pass
- `pnpm --filter @mozetto/reconciliation-worker typecheck` — pass
- `pnpm --filter @mozetto/chain-indexer typecheck` — pass
- `pnpm --filter @mozetto/api typecheck` — pass

**Out of scope:** Spec mutations; balance minting / silent ledger repair; Safe signing (WP-093).

**Follow-up:** Wire worker into hosted recipes (WP-086); WP-101 chaos auto-pause drill.

### 2026-08-07 — WP-090 Public Verify Game page (DONE)

**Status:** `DONE`

**Delivered:**
- Public API: `GET /v1/verify/session/:id`, `/hand/:id`, `/resolve?q=`, `/session/:id/events` (`services/api/src/verify.ts`)
- Plan 10 result categories + component matrix (`verify-status.ts`); never greenwash pending data
- Web UI: `/verify`, `/verify/[sessionId]`, `/verify/hand/[handId]` — roots, VRF, settlement digests, CLI evidence
- Local fixture verify: browser WASM when `pnpm sync:poker-wasm-web` published; else `POST /api/verify/fixture` via `@mozetto/game-rules`
- Sample fixture + fairness/landing links; docs `docs/WP-090_VERIFY_GAME.md`

**Commands / evidence:**
- `pnpm --filter @mozetto/api test` — pass (verify-status + admin-ops)
- `pnpm --filter @mozetto/api typecheck` — pass
- `pnpm --filter @mozetto/web typecheck` — pass

**Out of scope:** Spec mutations; admin secrets in public UI; full PokerEventV1 engine replay in browser.

**Follow-up:** WP-093–095 governance/watchtower. Inclusion-proof persistence: see WP-090/085 follow-up below.

### 2026-08-07 — WP-091 Admin chain/solvency dashboard (DONE)

**Status:** `DONE`

**Delivered:**
- Read-only API: `GET /v1/admin/solvency`, `GET /v1/admin/chain` (`services/api/src/admin-solvency.ts`) — vault / fee vault / mirrors / live `compareBalances` / indexer lag / reconciliation history
- Admin UI: `apps/admin/src/app/solvency/page.tsx` + nav; overview links to solvency
- Serializers + `PROTOCOL SOLVENT|INSOLVENT|UNAVAILABLE` banner helpers in `@mozetto/reconciliation`
- Token-gated via existing `ADMIN_TOKEN` (`requireAdmin` + admin middleware)
- Docs: `docs/WP-091_ADMIN_SOLVENCY_DASHBOARD.md`

**Commands / evidence:**
- `pnpm --filter @mozetto/reconciliation test` — **18/18 pass**
- `pnpm --filter @mozetto/reconciliation typecheck` — pass
- `pnpm --filter @mozetto/api typecheck` — pass
- `pnpm --filter @mozetto/admin typecheck` — pass

**Out of scope:** Spec mutations; balance mutations; Safe/browser signing (WP-093); WP-083 worker loop ownership; WP-092 AI/session panels.

**Follow-up:** WP-094 RBAC/MFA (DONE).

### 2026-08-07 — WP-092 Admin session/randomness/AI dashboard (DONE)

**Status:** `DONE`

**Delivered:**
- Read-only APIs: enhanced `GET /v1/admin/sessions`, `GET /v1/admin/session/:id`, `GET /v1/admin/randomness`, `GET /v1/admin/ai/health` (`services/api/src/admin.ts` + `admin-ops.ts`)
- Admin UI: sessions list/detail, `/randomness`, `/ai` — coordinated with WP-091 `/solvency` nav split
- Health helpers + unit tests (`admin-ops.test.ts`)
- Docs: `docs/WP-092_ADMIN_OPS_DASHBOARD.md`

**Commands / evidence:**
- `pnpm --filter @mozetto/api test` — pass
- `pnpm --filter @mozetto/api typecheck` — pass
- `pnpm --filter @mozetto/admin typecheck` — pass

**Out of scope:** Spec mutations; settlement/stack mutation; Safe/browser keys (WP-093); RBAC/MFA (WP-094 — DONE separately).

**Follow-up:** Consume pause/under-review ops in game-server; governance recovery via WP-093.

### 2026-08-07 — WP-094 Audit log and RBAC (DONE)

**Status:** `DONE`

**Delivered:**
- Migration `022_admin_audit_rbac.sql` — enrich `admin_actions`, append-only triggers, `admin_principals` (SSO/MFA-ready), `admin_session_ops`, RLS without permissive policies
- Append-only write path: `packages/database/src/admin-audit.ts` (`appendAdminAction`, `mutateSessionOps`)
- RBAC on admin API: `services/api/src/admin-auth.ts` — `ADMIN_READ_TOKEN` (viewer/read) vs `ADMIN_MUTATE_TOKEN` / `ADMIN_TOKEN` (mutate); all GETs require `read`; `POST …/ops` requires `mutate`
- Narrow Plan 13 ops: pause after hand / under review / request replay (no balance edits)
- Admin UI: `/audit`, session ops panel, middleware accepts role tokens; separate-deploy + MFA-in-front notes
- Docs: `docs/WP-094_AUDIT_RBAC.md`; `.env.example` RBAC tokens

**Commands / evidence:**
- `pnpm --filter @mozetto/database test` — pass (incl. session-ops helpers)
- `pnpm --filter @mozetto/database typecheck` — pass
- `pnpm --filter @mozetto/api test` — pass (incl. `admin-auth.test.ts`)
- `pnpm --filter @mozetto/api typecheck` — pass
- `pnpm --filter @mozetto/admin typecheck` — pass

**Out of scope:** Spec mutations; weakening RLS; browser secrets / `NEXT_PUBLIC_` tokens; full IdP SSO wiring; Safe signing (WP-093); balance edits.

**Follow-up:** IdP → `admin_principals`; game-server consume `pause_after_hand`; SIEM export of `admin_actions`.

### 2026-08-07 — WP-093 Safe/timelock proposal integration (DONE)

**Status:** `DONE`

**Delivered:**
- Package `@mozetto/governance` — calldata builders for critical Ownable/owner actions (GameRegistryV2, ProtocolFeeVault, ProofBatchRegistry, ArenaVault, VerifierRouter, SignatureQuorumVerifier, SettlementHubV3, TimelockController)
- Safe Transaction Builder JSON + mock local Protocol/Treasury Safe (addresses only; no keys)
- Optional wrap: Safe → OZ TimelockController.schedule/execute
- Admin UI `/governance` — prepare/export proposals; never embeds operator private keys
- CLI: `pnpm --filter @mozetto/governance propose` (+ `--mock-receipt`)
- Env metadata: `PROTOCOL_SAFE_ADDRESS`, `TREASURY_SAFE_ADDRESS`, `TIMELOCK_CONTROLLER_ADDRESS` in `.env.example`
- Docs: `docs/WP-093_SAFE_TIMELOCK.md`

**Commands / evidence:**
- `pnpm --filter @mozetto/governance test` — **12/12 pass**
- `pnpm --filter @mozetto/governance typecheck` — pass
- `pnpm --filter @mozetto/admin typecheck` — pass
- CLI smoke: `propose --action gameRegistry.setMinDelay … --mock-receipt` emits Safe Tx Builder JSON with `containsPrivateKeys: false`

**Out of scope:** Spec mutations; real mainnet Safe deploy; in-browser signing / wallet connect; secrets in repo; Anvil TimelockController deploy (env wire-up only).

**Follow-up:** Publish production Safe + TimelockController addresses in chain-manifest after Sepolia/mainnet; optional server-side proposal archive under WP-094 audit log.

### 2026-08-07 — WP-080 Table actor lease/recovery (DONE)

**Status:** `DONE`

**Delivered:**
- Hardened lease module `services/game-server/src/lease/` — versioned acquire/renew/release, wait-for-expiry reclaim, heartbeat, fencing token
- Backends: `MemoryLeaseBackend` (tests + single replica) + `RedisLeaseBackend` (multi-replica; Redis down ⇒ refuse start)
- Recovery: `replayDurableEvents` / `recoverActorTip` verify `hand_events` sequence + prev-hash tip; broken chain blocks actor loop
- Game-server wire: lease before load, assert before mutate, unload on lease loss, release on SIGINT/SIGTERM
- Tests: contention, expiry reclaim, wait-acquire, hash-break / gap detection
- Docs: `docs/WP-080_TABLE_ACTOR_LEASE.md`

**Commands / evidence:**
- `pnpm --filter @mozetto/game-server test` — **13/13 pass**
- `pnpm --filter @mozetto/game-server typecheck` — pass

**Out of scope:** Spec mutations; SettlementHub; full mid-hand engine replay from payloads; WP-081 outbox.

**Follow-up:** WP-081 persist-before-broadcast; multi-replica chaos under Redis.

### 2026-08-07 — WP-082 Chain indexer V3 (DONE)

**Status:** `DONE`

**Delivered:**
- Modular `services/chain-indexer/src/` — config/events/cursor/money/projections/reorg/metrics/health/tick
- V3/V2-additive watch list from chain-manifest (skip null addresses): GameRegistry, SessionLifecycle, ProtocolFeeVault, RandomnessBeacon, ProofBatchRegistry, SettlementHub V2/V3, CheckpointRegistry, RandomnessCoordinator
- Sole-writer money path unchanged: only Deposited / Withdrawn / BuyInLocked / SessionPayout mutate ledger
- Reorg: block-hash lookback → mark removed → rewind deposit mirrors → reset cursor
- Rebuild: `INDEXER_REBUILD=1` / `--rebuild` / `pnpm rebuild` → cursor = deploymentBlock (idempotent replay)
- Health: `INDEXER_HEALTH_PORT` `/health` + `/metrics` (lagBlocks, reorgs, watched contracts)
- Docs: `docs/WP-082_CHAIN_INDEXER_V3.md`

**Commands / evidence:**
- `pnpm --filter @mozetto/chain-indexer test` — **12/12 pass**
- `pnpm --filter @mozetto/chain-indexer typecheck` — pass

**Out of scope:** Spec mutations; TemplateRegistered struct decode; WP-083 reconciliation worker; live Anvil reorg chaos.

**Follow-up:** WP-083 reconciliation worker; deploy V3 contracts into Anvil manifest so additive sources are live locally.

### 2026-08-07 — WP-085 Proof-batch publisher (DONE)

**Status:** `DONE`

**Delivered:**
- Package `@mozetto/proof-batch-publisher` — aggregate checkpoint roots → `globalRoot` / `proofBatchHash` via `@mozetto/root-builder`
- Season-1 continuity: sequence +1, `previousBatchRoot` = prior `globalRoot` (genesis `bytes32(0)`)
- `MockRegistryClient` (unit) + `createViemRegistryClient` → `ProofBatchRegistryV1.registerBatch`
- Inclusion proofs per checkpoint leaf; `dataManifestHash` (explicit / CID / deterministic leaf package)
- `ProofBatchPublisher` + `runPublisherLoop` (2–5s interval; empty drains skip)
- Optional runner: `pnpm --filter @mozetto/proof-batch-publisher start` (`PROOF_BATCH_DEMO_LEAVES=1`)
- Docs: `docs/WP-085_PROOF_BATCH_PUBLISHER.md`; root CI includes package

**Commands / evidence:**
- `pnpm --filter @mozetto/proof-batch-publisher test` — **13/13** pass (vector 13 + continuity / mock registry)
- `pnpm --filter @mozetto/proof-batch-publisher typecheck` — pass

**Spec clauses:** `MOZETTO_PROOF_BATCH_V1` §§3–4, §6–8; WP-062 registry submitter; Plan 10 global proof batch.

**Out of scope:** Spec mutations; persistent checkpoint feeder / CID blob store; enabling Hub `requireProofBatch`; WP-084 settlement cutover.

**Follow-up:** Wire publisher into continuous ops; enable `requireProofBatch` once Anvil/Sepolia feeds are stable; WP-084 (**DONE**).

### 2026-08-07 — WP-084 Settlement worker V3 (DONE)

**Status:** `DONE`

**Delivered:**
- Additive V3 path in `services/settlement-worker` beside retained Hub V2 Anvil demo path
- `buildV3Proposal` via `@mozetto/root-builder` (conservation + seat-ordered balanceRoot + EIP-712 digests)
- Quorum via `@mozetto/attestors` (`game` / `dealer` / `replay`); optional HTTP V3 adapters (`SETTLEMENT_V3_HTTP_ATTEST=1`)
- `PokerSettlementHubV3.settle` + `waitForTransactionReceipt` → proposal `confirmed`
- Rating update uses FinalSettlementV3 digest as `eventLogRoot` (`reason=onchain_settled_v3`)
- Mode: `SETTLEMENT_HUB_V3_ADDRESS` or `SETTLEMENT_HUB_VERSION=v3|v2`
- Docs: `docs/WP-084_SETTLEMENT_WORKER_V3.md`; root CI `test:unit` / `typecheck:ci` include package

**Commands / evidence:**
- `pnpm --filter @mozetto/settlement-worker test` — **11/11 pass**
- `pnpm --filter @mozetto/settlement-worker typecheck` — pass

**Out of scope:** Spec mutations; collapsing attestor keys; dealer/replay HTTP still V2 until service cutover; enabling `requireProofBatch` by default.

**Follow-up:** Dealer + replay-verifier `/v1/...attest-v3`; WP-100 Anvil E2E with Hub V3 as vault primary; WP-083 reconciliation.

**Follow-up (WP-085 residual):** Wire game-server/settlement checkpoint emission into `CheckpointSource`. Inclusion proofs: WP-090/085 follow-up (DONE).

### 2026-08-07 — WP-084 follow-up: attest-v3 HTTP (DONE)

**Status:** `DONE` (WP-084 follow-up — no new WP number)

**Delivered:**
- Dealer `POST /v1/dealer/attest-v3` signs FinalSettlementV3 with `DEALER_ATTESTOR_PRIVATE_KEY` via `@mozetto/attestors`
- Replay-verifier `POST /v1/attest-settlement-v3` signs with `REPLAY_ATTESTOR_PRIVATE_KEY`
- Shared HTTP serialize/parse in `@mozetto/attestors`
- Settlement-worker `defaultV3HttpAdapters` wires those paths **by default** on V3 mode (`SETTLEMENT_V3_HTTP_ATTEST=0` to opt out)
- V2 `/v1/dealer/attest` + `/v1/verify-session` retained for Anvil Hub V2 demos
- Docs: `docs/WP-084_ATTEST_V3_HTTP.md` (+ WP-084 note update)

**Commands / evidence:**
- `pnpm --filter @mozetto/attestors test`
- `pnpm --filter @mozetto/dealer test`
- `pnpm --filter @mozetto/replay-verifier test`
- `pnpm --filter @mozetto/settlement-worker test`

**Out of scope:** Spec mutations; collapsing GAME/DEALER/REPLAY keys; breaking V2 Anvil path.

**Follow-up:** Separate process boundaries per role on Sepolia+; WP-100 Anvil E2E with Hub V3 as vault primary.

### 2026-08-07 — WP-054 Nitro Enclave dealer (DONE)

**Status:** `DONE` (scaffold + mock attestation; **not** a production TEE claim)

**Delivered:**
- Package `@mozetto/dealer-enclave` under `services/dealer-enclave/`
- Attestation document verifier interface + `MockAttestationVerifier` (Anvil/local) + refusing `NitroAttestationVerifier` stub
- `DealerBatchAttestation` sign/verify (Plan 05 / Randomness V2 §6 fields)
- Private card delivery sealed to seat (X25519 ECDH + AES-256-GCM)
- Mock KMS PCR-gated DEK release (`productionKms` / `productionTeeVerified` always false in mock)
- Plan 05 internal HTTP API: commit-batch / bind-vrf / prepare-decks / open-public-card / deliver-private-cards / attestation
- Docker stubs: `Dockerfile.dealer-enclave`, `Dockerfile.enclave`, `nitro/build.sh` (exits without `nitro-cli`)
- Docs: `docs/WP-054_NITRO_ENCLAVE_DEALER.md`; root CI includes package

**Commands / evidence:**
- `pnpm --filter @mozetto/dealer-enclave test` — **9/9 pass**
- `pnpm --filter @mozetto/dealer-enclave typecheck` — pass

**Requires real AWS Nitro for production:**
- `nitro-cli build-enclave` / `describe-eif` PCR publish
- NSM COSE Sign1 + AWS Nitro Attestation PKI verification
- KMS key policy `kms:RecipientAttestation:PCR*`
- Running dealer secrets only inside the EIF (vsock parent)

**Compatibility:** No `/specs` mutations; WP-051 `@mozetto/dealer-deck` consumed; `services/dealer` non-enclave path retained for local demo.

**Follow-up:** Cut over live dealer secrets into EIF on Nitro host; wire parent vsock; publish measurements; WP-090 verify page can surface attestation.

### 2026-08-07 — WP-101 Chaos suite (DONE)

**Status:** `DONE` (unit suite green in CI; live multi-container optional)

**Delivered:**
- Composable chaos under `scripts/chaos/` — unit (CI) + live (`docker-compose.hosted.yml`)
- Scenarios: game-kill (lease reclaim + outbox drain), indexer lag/restart, worker restart (no double-pay guards), DB disconnect (persist-before-broadcast)
- Entrypoints: `pnpm test:chaos` / `test:chaos:live` / `test:chaos:all`; CI step for unit suite
- Expected-outcome matrix + honest Plan 14 coverage gaps in `docs/WP-101_CHAOS_SUITE.md`
- PROGRESS status → DONE

**Commands / evidence:**
- `pnpm test:chaos` — **4/4 scenarios pass** (game-kill, indexer-lag, worker-restart, db-disconnect)
- Live compose kill/restart **not** executed in this packet (requires hosted stack + secrets)

**Out of scope:** Spec mutations; faking live CI green; full Plan 14 matrix (Redis dual-replica, VRF, dealer enclave, RPC failover); production incident tooling.

**Follow-up:** Staging `CHAOS_LIVE=1` drill; Redis multi-replica lease chaos; seeded Anvil double-settle race beside WP-100.

### 2026-08-07 — WP-095 Watchtower prototype (DONE)

**Status:** `DONE`

**Delivered:**
- Package `@mozetto/watchtower` — independent consumer of public proof/randomness/balance data (no operator keys)
- Rebuilds proof-batch `globalRoot` / `proofBatchHash` via `@mozetto/root-builder`; continuity walk; checkpoint inclusion
- Balance root + Merkle inclusion + settlement conservation; randomness golden/openings via `@mozetto/randomness-verifier`
- Read-only sources: `MemoryBatchSource` (tests) + `createViemBatchSource` (ProofBatchRegistry view calls only)
- Plan 10 status categories: `VERIFIED` / `VERIFIED_WITH_ATTESTED_PRIVATE_DEALER` / `PENDING_*` / `INCOMPLETE_PUBLIC_DATA` / `VERIFICATION_FAILED`
- CLI health report: `pnpm watchtower` (exit 0/1); offline fixtures from vectors 05/13
- Docs: `docs/WP-095_WATCHTOWER.md`; root `test:unit` / `typecheck:ci` include package

**Commands / evidence:**
- `pnpm --filter @mozetto/watchtower test` — **15/15** pass
- `pnpm --filter @mozetto/watchtower typecheck` — pass
- `pnpm watchtower -- --quiet` — `PASS status=VERIFIED`

**Spec clauses:** Plan 10 public verify categories + proof-batch continuity; `MOZETTO_PROOF_BATCH_V1` / `MOZETTO_RANDOMNESS_V2` via existing libraries; WP-062 registry read surface.

**Out of scope:** Spec mutations; publisher/attestor private keys; WASM full-table replay (WP-064/090); hosted continuous watchtower worker; `watchtower_reports` DB table.

**Follow-up:** WP-090 verify page can deep-link health reports; optional hosted loop over live registry views.

### 2026-08-07 — WP-100 Full Anvil E2E (DONE)

**Status:** `DONE` (Phase 9 exit as far as currently implementable — `PASS_WITH_GAPS`)

**Delivered:**
- Unified orchestrator `scripts/anvil-e2e-protocol-v3.mjs` + wrapper `scripts/anvil-e2e-protocol-v3.sh`
- pnpm: `e2e:protocol-v3`, `e2e:protocol-v3:redeploy` (`SETTLEMENT_HUB_V3_AS_PRIMARY=1`)
- On-chain path: mint → ArenaAccounts → fund → GamePermission → openSession lock → SessionLifecycle seal → compose mock VRF+deck → compose proof-batch → Hub V3 quorum settle → ProtocolFeeVault rake sweep → owner withdraw → reconcile
- Clear PASS/FAIL/GAP/SKIP report + `scripts/.anvil-e2e-protocol-v3-last.json`
- Docs: `docs/WP-100_ANVIL_E2E.md`

**Composed (not rewritten):** `e2e:mock-vrf --with-deck`, `e2e:proof-batch`; optional `--with-api` → `e2e:arena-account`, `--with-instant` → `smoke:custody --run`

**Commands / evidence:**
- `pnpm e2e:protocol-v3:redeploy` → **overall `PASS_WITH_GAPS`**, FAIL=0
- PASS stages: mint, ArenaAccounts, fund, GamePermission, lock, lifecycle seal, mock VRF+deck, proof batch, Hub V3 settle, rake sweep, withdraw, reconcile
- Documented GAPs: API ranked match (no `--with-api`), `sealAndFundSession` atomic path, AI hands / continuous cognition (stub settlement roots)

**Spec clauses:** Phase 9 MockUSDC lifecycle; Plan 14 Full Anvil E2E scenario (subset with honest gaps).

**Out of scope / intentional gaps:** 100+ AI hands live; WP-041 `sealAndFundSession` submit; API matchmaker without `--with-api`; Sepolia (WP-102).

**Follow-up:** Real event/hand/balance roots after settlement cutover; optional seal coordinator submit; WP-102 Sepolia.

### 2026-08-07 — WP-090/085 inclusion-proof follow-up (DONE)

**Status:** `DONE` (follow-up; no new WP number)

**Delivered:**
- Migration `023_proof_batch_inclusion.sql` — `proof_batches` + `proof_batch_inclusion_proofs`
- `@mozetto/proof-batch-publisher` persist hook: `InclusionProofStore`, memory / JSON file / SQL port; auto-write after accepted register
- `@mozetto/database` helpers: `persistProofBatchInclusionArtifact`, `listInclusionProofsForSession`, `inclusionComponentStatus`
- Public Verify API: `proofBatchInclusion` on session payload; resolve by checkpoint/global/proofBatchHash
- Verify UI: component tile + Merkle path section (safe fields only)
- Docs: `docs/WP-090_VERIFY_GAME.md`, `docs/WP-085_PROOF_BATCH_PUBLISHER.md`

**Commands / evidence:**
- `pnpm --filter @mozetto/proof-batch-publisher test`
- `pnpm --filter @mozetto/database test`
- `pnpm --filter @mozetto/api test`

**Out of scope:** Spec mutations; changing Plan 10 public result categories; private keys / dealer secrets on public routes.

**Follow-up:** Wire continuous `CheckpointSource` + SQL inclusion store in hosted publisher runner.

### 2026-08-07 — WP-102 Sepolia deployment/manifest (DONE — recipes)

**Status:** `DONE` with honest deferral: **recipes ready; live tx pending ops**

**Delivered:**
- `DeploySepolia.s.sol` V3 parity with Anvil: GameRegistryV2, SessionLifecycleV2, Hub V3 + VerifierRouter, ProofBatchRegistry, RandomnessBeaconV2, ProtocolFeeVault; optional attestor env hooks
- Manifest write gated by `WRITE_CHAIN_MANIFEST=1` (no dry-run simulated addresses)
- Recipes: `scripts/sepolia-deploy.sh` / `sepolia-verify.sh` / `sepolia-merge-vrf-adapter.mjs`
- pnpm: `sepolia:check`, `sepolia:dry-run`, `sepolia:deploy`, `sepolia:verify`
- Chain-manifest Sepolia slot `deployments/baseSepolia.json` — Circle USDC + VRF constants; **protocol addresses null** until broadcast
- Codegen default `protocolVersion: 2.0.0-sepolia`
- Env checklist names in `.env.example`; docs `docs/WP-102_SEPOLIA_DEPLOYMENT.md`
- Exit criteria documented for WP-103

**Commands / evidence:**
- `forge build` — DeploySepolia compiles
- `pnpm manifest:codegen` — baseSepolia addresses remain null
- `pnpm sepolia:check` — RPC `84532` OK; local `PRIVATE_KEY` is Anvil #0 with ~0 ETH → **balance_gate=FAIL** (broadcast refused)
- `@mozetto/chain-manifest` tests — 6/6 pass

**Spec clauses:** Plan 14 Sepolia deployment gate (script + manifest automation); Phase 11 deploy/verify/manifest workstream (live hosted program → WP-103).

**Out of scope / intentional gaps:** Live Base Sepolia broadcast (unfunded deployer); inventing fake addresses; mainnet; committing secrets; 3-of-5 attestor set (ops before WP-103).

**Follow-up:** Fund ops deployer → `pnpm sepolia:deploy` → verify → Chainlink VRF adapter (WP-053) → commit real manifest → WP-103 Stage A.

### 2026-08-07 — WP-103 Public testnet program (DONE — program scaffold)

**Status:** `DONE` for invited→adversarial **program definition + ops scaffolding**. Live Stage A/B/C **blocked** until WP-102 live broadcast fills `baseSepolia.json`.

**Delivered:**
- `docs/WP-103_PUBLIC_TESTNET_PROGRAM.md` — Stage A (team-only), B (invited), C (adversarial): entry/exit, caps, IR, pause summary, success metrics; pointers to WP-104 / WP-105
- `scripts/testnet/STAGE_A_CHECKLIST.md` — human checklist once manifest is filled
- `scripts/testnet/PAUSE_RUNBOOK.md` — matchmaking / vault / registry / unpause
- `scripts/testnet/check-manifest.mjs` + `stage-a-gate.sh` — honest null → exit 1
- `scripts/testnet/health-check.sh` + `verify-cli-hints.sh`
- pnpm: `testnet:stage-a-gate`, `testnet:health`, `testnet:verify-hints`

**Commands / evidence:**
- `pnpm testnet:stage-a-gate` → **FAIL** (11 required protocol addresses null; VRF adapter null) — expected until ops deploy
- `pnpm testnet:verify-hints` → prints Verify Game + watchtower + randomness CLI pointers
- No invented Sepolia addresses; manifest `_status=recipes-ready-live-tx-pending-ops` unchanged

**Spec clauses:** Plan 14 Sepolia program Stages A/B/C + expansion metrics + mainnet readiness pointer; WP-103 “Invited then adversarial”.

**Out of scope / intentional gaps:** Live Stage A execution; inventing addresses; mainnet; commits of secrets; claiming network live.

**Honest blockers (Stage A):** live `pnpm sepolia:deploy`, VRF subscription + adapter merge, attestor 3-of-N, funded team accounts, hosted stack on manifest, Verify/reindex smoke.

**Follow-up:** Ops fill manifest → Stage A checklist → B/C over weeks → file findings into **WP-104** register → **WP-105** restricted mainnet gates only after Plan 14 readiness.

### 2026-08-07 — WP-104 Audit remediation (DONE — scaffold)

**Status:** `DONE` for remediation **register + taxonomy + verification rules + CI hook**. External multi-stream audits and Stage C adversarial outputs are **not** claimed complete. No invented Critical vulns.

**Delivered:**
- `docs/WP-104_AUDIT_REMEDIATION.md` — severity taxonomy, lifecycle (code fix ≠ closed), independent verification checklist, Plan 14 streams, mainnet gate pointer
- `docs/audits/FINDINGS.md` — human register: template, example CLOSED process finding, WP-100 / WP-054 / WP-102 residual gaps
- `docs/audits/register.yaml` — machine register (schema_version 1)
- `scripts/audits/check-register.mjs` — integrity check (CLOSED evidence, anti-fake `external-audit`, optional `--gate-mainnet`)
- pnpm: `audit:register-check`; CI step in `.github/workflows/ci.yml`
- Pointers to WP-101 chaos, WP-095 watchtower, WP-090 verify, WP-083 reconcile

**Commands / evidence:**
- `pnpm audit:register-check` → **PASS** (7 findings: 1 TEMPLATE, 1 CLOSED example, 3 OPEN residual, 2 DEFERRED residual; open Critical/High = 0)
- `pnpm audit:register-check -- --gate-mainnet` → **PASS** (no open Critical/High; Residual gaps do not fail this gate)

**Spec clauses:** Plan 14 audit streams + mainnet readiness “critical/high findings closed”; Plan 17 testing/audit checklist items for audit closure tracking; WP-104 “Track findings to independently verified closure.”

**Out of scope / intentional gaps:** Spec mutations; claiming paid audits done; inventing Critical findings; mainnet deploy; closing Residual WP-100 gaps (tracked OPEN/DEFERRED honestly).

**Follow-up:** Stage C / internal / external findings file into register → independent verify → close Critical/High before WP-105; keep Residual rows until E2E/Nitro/Sepolia land.

### 2026-08-07 — WP-105 Restricted mainnet deployment (DONE — recipes/gates)

**Status:** `DONE` for **recipes and gates only**. Live restricted Base mainnet = **BLOCKED** pending WP-104 criticals closed (external audits), Stage C complete, Safe/timelock live, caps/allowlist, and explicit `finalGateApproval`.

**Delivered:**
- `docs/WP-105_RESTRICTED_MAINNET.md` — Plan 14 entry gates, restricted posture, env names, DeploySepolia cutover recipe
- `scripts/mainnet/GATES.json` — all required gates `false` including `finalGateApproval`
- `scripts/mainnet/check-gates.mjs` + `gate.sh` → `pnpm mainnet:gate` (FAIL until gates satisfied)
- `scripts/mainnet/check-manifest.mjs` — honesty null-check + deployed null-fail
- `scripts/mainnet/deploy.sh` → `pnpm mainnet:check|dry-run|deploy` (**refuses broadcast**)
- `scripts/mainnet/RESTRICTED_MAINNET_CHECKLIST.md`
- `packages/chain-manifest/deployments/base.json` — Circle USDC + VRF constants; **protocol addresses null**
- Codegen default `protocolVersion: 2.0.0-mainnet-restricted`
- `contracts/script/DeployMainnet.s.sol` — guarded stub (MockUSDC forbidden; approval required; always reverts)
- Env checklist names in `.env.example`

**Commands / evidence:**
- `pnpm mainnet:gate` → **FAIL** (18/18 gates unsatisfied; `finalGateApproval=false`)
- `pnpm mainnet:check-manifest -- --honesty` → **PASS** (honest nulls)
- `pnpm mainnet:check-manifest` → **FAIL** (not deployed)
- `pnpm mainnet:deploy` → **REFUSE** broadcast
- `pnpm manifest:codegen` — base protocol addresses remain null
- `node --test packages/chain-manifest/src/mainnet-guard.test.ts` — **6/6 pass**
- `forge build` — DeployMainnet stub compiles
- No mainnet broadcast; no invented addresses

**Spec clauses:** Plan 14 mainnet readiness gate + restricted launch posture; WP-105 “Only after final gate approval”; Plan 17 DoD pointer.

**Out of scope / intentional gaps:** Live mainnet broadcast; inventing `base.json` addresses; flipping `finalGateApproval`; full DeploySepolia→DeployMainnet cutover (documented for post-approval); claiming mainnet live.

**Follow-up:** Stage C + WP-104 close → evidence-flip `GATES.json` → `finalGateApproval` last → DeployMainnet cutover → ops-approved broadcast only.

---

### 2026-08-07 — Plan 11 Rake, unit economics, and treasury (DONE)

**Status:** `DONE` (with documented deferrals)

**Artifacts:**
- Rake formula + conservation: `packages/game-rules/src/rake.ts` (+ `rake.test.ts`); `holdem.ts` uses `computeRakeFromPct` / `allocateSidePotRake`
- Rust Plan 11 `compute_rake` unit tests: `crates/poker-core/src/types.rs` `rake_tests`
- Unit economics package: `packages/unit-economics/` — Season 1 schedule **hypotheses**, contribution identity, revenue transparency builder, AI cost bands
- Admin reporting hook: `services/api/src/admin-treasury.ts` → `GET /v1/admin/treasury`; UI `apps/admin/src/app/treasury/`
- Mapping doc: `docs/PLAN_11_RAKE_TREASURY.md`
- Prior: ProtocolFeeVault WP-024, settlement conservation WP-061/063, Energy WP-074 (unchanged fee types)

**Commands / evidence:**
- `pnpm --filter @mozetto/game-rules test` — **90/90 pass** (includes Plan 11 rake suite)
- `pnpm --filter @mozetto/unit-economics test` — **8/8 pass**
- `cargo test -p poker-core rake_tests` — **3/3 pass**
- `cd contracts && forge test --match-contract ProtocolFeeVault` — **16/16 pass**

**Season 1 economics:** Provisional league rake table explicitly `status: "hypothesis"` — not automatic mainnet / GameTemplate freeze.

**Deferred:** uncalled-bet exclusion from eligible pot; full AI/chain/infra COGS instrumentation; worker auto-`ProtocolFeeVault.sweep`; per-league unit-econ acceptance report; high-stakes gate evidence pack.

**Out of scope:** `/specs` mutations; new player fee types; mainnet deploy; silent Season 1 schedule freeze.

**Follow-up:** Instrument COGS from Anvil→Sepolia; uncalled-bet return in engine; Safe-owned sweep ops; league reports before fee freeze.

---

### 2026-08-07 — Plan 19 Database schema and API migration (DONE)

**Status:** `DONE` (with documented deferrals)

**Inventory:** Plan 19 proposed filenames `017`–`026` do **not** match shipped WP migrations at those numbers. Closure maps clauses → actual artifacts; no renumbering / breaking renames.

**Delivered:**
- Closure map: `docs/PLAN_19_DATABASE_API_MIGRATION.md`
- Forward migrations `024`–`029`: protocol manifests, session lifecycle V2 projection, agent brain/energy, identity clusters, verification packages, randomness/deck batches
- Plan 19 public API aliases: `services/api/src/plan19-routes.ts` + verify path aliases
- `DbLinkedAccountStore` (`packages/database/src/identity-clusters.ts`) over `identity_cluster_edges`
- WP-072/074 docs updated: schema no longer the persistence blocker

**Commands / evidence:**
- `pnpm --filter @mozetto/database test` — **44/44 pass**
- `pnpm --filter @mozetto/database typecheck` — pass
- `pnpm --filter @mozetto/api typecheck` — pass
- `pnpm --filter @mozetto/agent-runtime exec node --import tsx --test src/state/state.test.ts` — **17/17 pass**

**Deferred:** per-service Postgres GRANTs; full WS v2 message cutover; hosted migrate apply for AgentState/Energy tables; `protocol_fee_sweeps` / `relayer_transactions` / `safe_proposals` tables; inventing VRF/proof roots for legacy sessions.

**Out of scope:** `/specs` mutations; destructive prod resets; rewriting working `001`–`023` migrations.

**Follow-up:** Apply `024`–`029` on hosted DBs; WS v2 cutover; role GRANTs. (AgentState/Energy writers: see session log below.)

---

### 2026-08-07 — Plan 19 follow-up: AgentState + Energy DB writers (DONE)

**Status:** `DONE` (writers + env select; hosted migrate **not** claimed)

**Delivered:**
- `DbAgentStateStore` over `agent_session_states` / `agent_state_checkpoints` (`services/agent-runtime/src/state/db-store.ts`)
- `createAgentStateStore` — `AGENT_STATE_STORE=memory|db` (default memory)
- `EnergyLedgerStore` + `InMemoryEnergyLedgerStore` + `DbEnergyLedgerStore` (`agent_energy_ledgers`)
- `createEnergyLedgerStore` — `ENERGY_LEDGER_STORE=memory|db` (default memory)
- Unit tests with mocked `SqlExec` (no live DB required)
- Docs: `docs/WP-072_AGENT_STATE_STORE.md`, `docs/WP-074_ENERGY_LEDGER.md`, `docs/PLAN_19_DATABASE_API_MIGRATION.md` deferral update
- `.env.example` flags

**Commands / evidence:**
- `pnpm --filter @mozetto/agent-runtime test` — **125/125 pass**
- `pnpm --filter @mozetto/agent-runtime typecheck` — pass

**Deferred:** Hosted `DATABASE_URL` migrate apply for `026`+; scheduler auto-persist hooks into cognition loops; per-service Postgres GRANTs.

**Out of scope:** `/specs` mutations; inventing new encodings; commits (unless asked).

---

### 2026-08-07 — WP-107 Live Groq AI table integration (DONE)

**Status:** `DONE`

**Delivered:**
- `LiveSessionManager` — observe → cognition → Energy → Groq/mock decide → validate → cadence schedule
- HTTP: `POST /v1/act`, `POST /v1/observe`, `POST /v1/hand/begin`, `GET /v1/metrics`, enriched `/health`
- Game-server `AgentRuntimeController` + public-event observe fan-out + table-clock cadence wait
- Env: `AGENT_RUNTIME_MODE`, `AGENT_CADENCE_WAIT`, `AI_CONTROLLER`, store factories respected
- Metrics stubs: illegal-action rate, fallback rate, Energy/hand, latency p50/p95
- Smoke harness: `pnpm smoke:groq-table` (mock CI-safe; `--mode live` + `GROQ_API_KEY` for Groq)
- Docs: `docs/WP-107_LIVE_GROQ_TABLE.md`
- Export: `@mozetto/agent-runtime/live`

**Commands / evidence:**
- `pnpm --filter @mozetto/agent-runtime test` — includes WP-107 live suites
- `pnpm smoke:groq-table -- --hands 3 --mode mock` — multi-hand autonomous HU
- `pnpm smoke:groq-table -- --hands 100 --mode mock` — scale path documented

**Security notes:** `GROQ_API_KEY` remains gitignored (`.env.local`); never committed or printed. No CoT in HTTP responses.

**Out of scope:** `/specs` mutations; WP-106 Anvil browser golden path; WP-108 real settlement roots; WP-111 full COGS.

**Follow-up:** Wire smoke into hosted AI tables; WP-111 consume `/v1/metrics` for economics.

---

### 2026-08-07 — WP-110 Hosted DB + WS cutover (DONE)

**Status:** `DONE` (with documented ops follow-ups)

**Verified:** `schema_migrations` held **017–029** on configured `DATABASE_URL` before this packet; **030** applied in-packet.

**Delivered:**
- Migration `030_service_role_grants.sql` — `mozetto_*` NOLOGIN roles + least-privilege GRANTs + `BYPASSRLS`; `service_role` table grants when present
- Scheduler persist hooks: `energyStore` on `ContinuousCognitionScheduler`; `createCognitionScheduler` factory; `LiveSessionManager` wires energy store
- WS v2 dual-accept inbound (`packages/shared-types/src/ws-protocol.ts`); outbound opt-in via `GAME_WS_EMIT_V2`
- Docs: `docs/WP-110_HOSTED_DB_WS.md`; Plan 19 deferral update; `.env.example`

**Commands / evidence:**
- `pnpm --filter @mozetto/database migrate` — `030` applied
- `pnpm --filter @mozetto/agent-runtime test` — **132/132 pass**
- `pnpm --filter @mozetto/game-server test` — **27/27 pass**
- `pnpm --filter @mozetto/{shared-types,agent-runtime,game-server} typecheck` — pass

**Deferred:** Dedicated per-service DSNs / `SET ROLE`; web clients reading v2 emit by default; additive lifecycle/energy/verify WS frames.

**Out of scope:** `/specs` mutations; destructive prod resets; committing secrets.

---

## Baseline inventory (post-WP-000)

| Item | Current state |
|---|---|
| Package manager | `pnpm@9.15.0` (packageManager + engines) |
| Node pin | `22` (`.nvmrc`, Dockerfiles, CI) |
| Foundry pin | `v1.7.1` (`.foundry-version`) |
| Rust pin | `1.85.0` (`rust-toolchain.toml`) |
| Local boot | `pnpm bootstrap` → readiness; also `scripts/start-local.sh` |
| Reset | `pnpm reset:local` (+ `--db`) |
| E2E scripts | `pnpm e2e:arena-account`, `e2e:instant`, `e2e:mock-vrf`, `e2e:proof-batch`, `e2e:protocol-v3`, `smoke:custody` |
| Migrations | `packages/database/migrations/001`–`030` (+ CI dry-run) |
| Architecture prose | `docs/PLATFORM_ARCHITECTURE.md` |
| Machine-readable manifest | `docs/architecture-manifest.v2.json` (+ `.md`; `pnpm manifest:architecture`) |
| Tool versions doc | `docs/TOOL_VERSIONS.md` |
| Root CI (`.github/workflows`) | `ci.yml` present |
| `/specs` | **Frozen** — WP-010–015 complete; TS/Rust/Solidity vectors agree |
| TS NLHE freeze (WP-030) | `packages/game-rules/fixtures/` + `docs/WP-030_TS_ENGINE_FREEZE.md` |
| Rust HU core (WP-031) | `crates/poker-core`, `crates/poker-eval` + `docs/WP-031_RUST_HU_PARITY.md` |
| Rust six-max core (WP-032) | multi/sixmax fixture replay + `docs/WP-032_RUST_SIXMAX_PARITY.md` |
| Hand evaluator (WP-033) | `crates/poker-eval/vectors/hand_eval_v1.json` + `docs/WP-033_HAND_EVALUATOR.md` |
| Differential harness (WP-034) | `tools/engine-diff/` + `docs/WP-034_DIFFERENTIAL_HARNESS.md` (`pnpm test:engine-diff`) |
| WASM verifier (WP-035) | `crates/poker-wasm` + `crates/poker-replay` + `docs/WP-035_WASM_VERIFIER.md` |
| Ranked matchmaker (WP-040) | `packages/database/src/ranked-matchmaker.ts` + `docs/WP-040_RANKED_RANDOM_MATCHMAKER.md` |
| Session seal coordinator (WP-041) | `packages/session-seal` + `docs/WP-041_SESSION_SEAL_COORDINATOR.md` |
| Epoch join/leave (WP-042) | `packages/database/src/epoch-rotation.ts` + `docs/WP-042_EPOCH_JOIN_LEAVE.md` |
| Anti-pairing / identity (WP-043) | `packages/database/src/linked-accounts.ts` + `docs/WP-043_ANTI_PAIRING.md` |
| Plan 12 ratings / anti-cheat | `packages/ratings` + `docs/PLAN_12_RATINGS_ANTICHEAT.md` |
| RandomnessBeaconV2 (WP-050) | `contracts/src/RandomnessBeaconV2.sol` + `docs/WP-050_RANDOMNESS_BEACON_V2.md` |
| Dealer deck library (WP-051) | `packages/dealer-deck` + `docs/WP-051_DEALER_DECK_LIBRARY.md` |
| Mock VRF Anvil (WP-052) | `contracts/script/MockVrfAnvil.s.sol` + `scripts/anvil-mock-vrf*.{sh,mjs}` + `docs/WP-052_MOCK_VRF_ANVIL.md` |
| Chainlink VRF adapter (WP-053) | `contracts/src/ChainlinkVrfAdapterV1.sol` + `docs/WP-053_CHAINLINK_VRF.md` |
| Nitro Enclave dealer (WP-054) | `services/dealer-enclave` + `docs/WP-054_NITRO_ENCLAVE_DEALER.md` (mock attestation; live Nitro ops follow-up) |
| Randomness verifier CLI (WP-055) | `packages/randomness-verifier` + `docs/WP-055_RANDOMNESS_VERIFIER.md` (`pnpm verify:randomness`) |
| Deterministic fallback (WP-076) | `services/agent-runtime/src/provider/deterministic-fallback.ts` + `docs/WP-076_DETERMINISTIC_FALLBACK.md` |
| Public cadence (WP-075) | `services/agent-runtime/src/cadence/` + `docs/WP-075_PUBLIC_CADENCE_CONTROLLER.md` |
| Continuous cognition (WP-073) | `services/agent-runtime/src/cognition/` + `docs/WP-073_CONTINUOUS_COGNITION.md` |
| Event store / hash chain (WP-060) | `packages/event-store` + `docs/WP-060_EVENT_HASH_CHAIN.md` + migration `019` |
| Persist-before-broadcast outbox (WP-081) | `services/game-server/src/outbox/` + `docs/WP-081_PERSIST_OUTBOX.md` + migration `020` |
| Reconciliation worker (WP-083) | `packages/reconciliation` + `services/reconciliation-worker` + `docs/WP-083_RECONCILIATION_WORKER.md` + migration `021` |
| Hand/balance root builder (WP-061) | `packages/root-builder` + `docs/WP-061_HAND_BALANCE_ROOTS.md` |
| Energy ledger (WP-074) | `services/agent-runtime/src/energy/` + `docs/WP-074_ENERGY_LEDGER.md` |
| AgentState store (WP-072) | `services/agent-runtime/src/state/` + `docs/WP-072_AGENT_STATE_STORE.md` |
| Poker eval harness (WP-077) | `services/agent-runtime/src/eval/` + `docs/WP-077_POKER_EVAL_HARNESS.md` (`pnpm eval:poker`) |
| ProofBatchRegistryV1 (WP-062) | `contracts/src/ProofBatchRegistryV1.sol` + `docs/WP-062_PROOF_BATCH_REGISTRY.md` (`pnpm e2e:proof-batch`) |
| SettlementHubV3 (WP-063) | `contracts/src/PokerSettlementHubV3.sol` + VerifierRouter + `docs/WP-063_SETTLEMENT_HUB_V3.md` |
| Attestor services (WP-065) | `packages/attestors` + `docs/WP-065_ATTESTOR_SERVICES.md` |
| Replay verifier (WP-064) | `services/replay-verifier` + `crates/poker-replay` + `docs/WP-064_REPLAY_VERIFIER.md` |
| Emergency exit (WP-066) | `ArenaVaultV2.emergencyExitWithBalanceLeaf` + `docs/WP-066_EMERGENCY_EXIT.md` |
| Table actor lease (WP-080) | `services/game-server/src/lease/` + `docs/WP-080_TABLE_ACTOR_LEASE.md` |
| Chain indexer V3 (WP-082) | `services/chain-indexer/` + `docs/WP-082_CHAIN_INDEXER_V3.md` |
| Proof-batch publisher (WP-085) | `packages/proof-batch-publisher` + `docs/WP-085_PROOF_BATCH_PUBLISHER.md` |
| Settlement worker V3 (WP-084) | `services/settlement-worker` + `docs/WP-084_SETTLEMENT_WORKER_V3.md` |
| Attest-v3 HTTP (WP-084 follow-up) | dealer `/v1/dealer/attest-v3` + replay `/v1/attest-settlement-v3` + `docs/WP-084_ATTEST_V3_HTTP.md` |
| Hosted deployment recipes (WP-086) | `docs/WP-086_HOSTED_DEPLOYMENT.md` + `render.yaml` + `docker-compose.hosted.yml` + `deploy/fly/` + `Dockerfile.*` |
| Product IA / design system (WP-120) | `apps/web` tokens/nav/ui + `docs/WP-120_PRODUCT_IA_DESIGN.md` |
| Public Verify Game (WP-090) | `apps/web/src/app/verify/` + `services/api/src/verify.ts` + `docs/WP-090_VERIFY_GAME.md` |
| Admin solvency dashboard (WP-091) | `apps/admin/src/app/solvency/` + `services/api/src/admin-solvency.ts` + `docs/WP-091_ADMIN_SOLVENCY_DASHBOARD.md` |
| Plan 11 rake / treasury | `packages/game-rules/src/rake.ts` + `packages/unit-economics/` + `docs/PLAN_11_RAKE_TREASURY.md` + `GET /v1/admin/treasury` |
| Admin ops dashboard (WP-092) | `apps/admin` sessions/randomness/ai + `services/api/src/admin-ops.ts` + `docs/WP-092_ADMIN_OPS_DASHBOARD.md` |
| Admin audit + RBAC (WP-094) | migration `022` + `packages/database/src/admin-audit.ts` + `services/api/src/admin-auth.ts` + `docs/WP-094_AUDIT_RBAC.md` |
| Safe/timelock proposals (WP-093) | `packages/governance` + `apps/admin/src/app/governance/` + `docs/WP-093_SAFE_TIMELOCK.md` |
| Chaos suite (WP-101) | `scripts/chaos/` + `docs/WP-101_CHAOS_SUITE.md` (`pnpm test:chaos`) |
| Full Anvil protocol E2E (WP-100) | `scripts/anvil-e2e-protocol-v3.{mjs,sh}` + `docs/WP-100_ANVIL_E2E.md` (`pnpm e2e:protocol-v3`) |
| Sepolia deploy recipes (WP-102) | `contracts/script/DeploySepolia.s.sol` + `scripts/sepolia-*.{sh,mjs}` + `docs/WP-102_SEPOLIA_DEPLOYMENT.md` (`pnpm sepolia:*`) — live tx pending ops |
| Public testnet program (WP-103) | `docs/WP-103_PUBLIC_TESTNET_PROGRAM.md` + `scripts/testnet/` (`pnpm testnet:*`) — live Stage A blocked on ops deploy |
| Audit remediation register (WP-104) | `docs/WP-104_AUDIT_REMEDIATION.md` + `docs/audits/` (`pnpm audit:register-check`) — scaffold; external audits pending |
| Restricted mainnet recipes/gates (WP-105) | `docs/WP-105_RESTRICTED_MAINNET.md` + `scripts/mainnet/` + `deployments/base.json` (`pnpm mainnet:*`) — live mainnet BLOCKED |
| Watchtower prototype (WP-095) | `packages/watchtower` + `docs/WP-095_WATCHTOWER.md` (`pnpm watchtower`) |
| Live Groq AI table (WP-107) | `services/agent-runtime/src/live/` + game-server wire + `docs/WP-107_LIVE_GROQ_TABLE.md` (`pnpm smoke:groq-table`) |
| Plan 19 DB/API migration | migrations `024`–`029` + `docs/PLAN_19_DATABASE_API_MIGRATION.md` + `services/api/src/plan19-routes.ts` |
| Hosted DB + WS cutover (WP-110) | migration `030` + scheduler persist + WS dual-accept + `docs/WP-110_HOSTED_DB_WS.md` |
| `baseline-v2` tag | Not created yet (await user) |
