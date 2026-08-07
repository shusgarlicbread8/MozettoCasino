# WP-100 — Full Anvil E2E

**Authority:** Phase 9 in `01_MASTER_EXECUTION_ROADMAP.md`, scenario in `14_ANVIL_SEPOLIA_MAINNET_TEST_AND_AUDIT_PLAN.md`, WP-100 in `16_AGENT_WORK_PACKETS.md`  
**Date:** 2026-08-07

---

## Delivered

| Item | Location |
|---|---|
| Unified Node orchestrator | `scripts/anvil-e2e-protocol-v3.mjs` |
| Anvil ensure + entry wrapper | `scripts/anvil-e2e-protocol-v3.sh` |
| pnpm entries | `pnpm e2e:protocol-v3` / `pnpm e2e:protocol-v3:redeploy` |
| Last-run report (gitignored) | `scripts/.anvil-e2e-protocol-v3-last.json` |
| This note | `docs/WP-100_ANVIL_E2E.md` |

Does **not** mutate frozen `/specs`. Prefer composing existing smoke/E2E rather than rewriting them.

---

## Lifecycle covered (as far as implementable)

```text
mint mUSDC
  → create/fund ArenaAccounts
  → grant GamePermission
  → lock buy-ins (openSession)
  → SessionLifecycleV2 draft → seal
  → mock VRF + dealer-deck batch          (composes e2e:mock-vrf --with-deck)
  → [hands GAP]
  → ProofBatchRegistry.registerBatch      (composes e2e:proof-batch)
  → Hub V3 quorum settle → ArenaAccounts  (requires --redeploy / Hub V3 primary)
  → rake → ProtocolFeeVault → treasury sweep
  → owner withdraw
  → reconcile locks + accrued fees = 0
```

Optional compose flags:

| Flag | Behavior |
|---|---|
| `--redeploy` | `DeployLocal` with `SETTLEMENT_HUB_V3_AS_PRIMARY=1` + chain-manifest codegen |
| `--with-api` | Also run `e2e:arena-account` (API + game server required) |
| `--with-instant` | Also run `smoke:custody --run` (Instant EOA path) |
| `--skip-composed` | Skip mock-vrf / proof-batch child scripts |

---

## How to run

```bash
# Preferred: clean Anvil + Hub V3 as vault settlement authority
pnpm e2e:protocol-v3:redeploy

# Anvil already up + existing anvil.json
pnpm e2e:protocol-v3

# Compose API match path when stack is up
pnpm e2e:protocol-v3 -- --with-api

# Instant custody smoke as an extra stage
pnpm e2e:protocol-v3 -- --with-instant
```

Exit code **0** when there are **no FAIL** stages. `GAP` / `SKIP` do not fail the run (`overall: PASS_WITH_GAPS`).

---

## PASS / FAIL / GAP semantics

| Status | Meaning |
|---|---|
| `PASS` | Assertion held end-to-end for that stage |
| `FAIL` | Assertion failed — process exits non-zero |
| `GAP` | Stage intentionally not fully wired yet; documented, not faked green |
| `SKIP` | Opted out by flag |

### Documented gaps (honest)

1. **Ranked match / find-match (API)** — On-chain path uses relayer `openSession` with session-signer tickets. Pass `--with-api` when API + game server are healthy to compose `e2e:arena-account`.
2. **`sealAndFundSession` (WP-041)** — `@mozetto/session-seal` coordinator exists; this E2E seals via `SessionLifecycleV2` draft→seal stubs alongside vault `openSession`, not the atomic V3 `sealAndFundSession` submit path.
3. **AI-only hands / continuous cognition** — WP-107 wires game-server ↔ agent-runtime; WP-108 ships `buildCanonicalSettlementRoots` + `REQUIRE_REAL_ROOTS=1` (see `docs/WP-108_REAL_CANONICAL_ROOTS.md`). This E2E still uses **synthetic** settle roots unless WP-106 wires the WP-108 API (gate refuses stubs when `REQUIRE_REAL_ROOTS=1`).
4. **Hub V3 without `--redeploy`** — If `vault.settlementHub` is still Hub V2, the script falls back to Anvil hub impersonation for `settleSession` and records Hub V3 quorum settle as `GAP`.

---

## Composed existing pieces

| Stage | Reuses |
|---|---|
| Mock VRF + decks | `scripts/anvil-mock-vrf-beacon.mjs` (`pnpm e2e:mock-vrf -- --with-deck`) |
| Proof batch | `scripts/anvil-proof-batch.sh` (`pnpm e2e:proof-batch`) |
| API match (optional) | `scripts/anvil-e2e-arena-account.mjs` |
| Instant custody (optional) | `scripts/anvil-custody-smoke.mjs --run` |

---

## Acceptance evidence (example)

```text
pnpm e2e:protocol-v3:redeploy
→ overall: PASS_WITH_GAPS
→ PASS includes: mint, ArenaAccounts, fund, GamePermission, lock, lifecycle seal,
  mock VRF+deck, proof batch, Hub V3 settle, rake sweep, withdraw, reconcile
→ GAP: match API, sealAndFundSession, AI hands
```

Conservation check on settle: `openingTotal == endingPlayerTotal + totalRake` (100+100 = 120+78+2).

---

## Follow-up

- Wire `--with-api` path into CI once long-lived Anvil+API+game fixtures exist.
- Replace stub settlement roots with event-store / root-builder output after WP-084 cutover.
- Optional: submit via `SessionSealCoordinator` → `sealAndFundSession` instead of `openSession`.
- WP-101 chaos suite on top of this happy path.
