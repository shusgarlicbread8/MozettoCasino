# WP-111 — Economics instrumentation

**Authority:** Plan 11; WP-111 in `mozetto_execution_plans/16_AGENT_WORK_PACKETS.md`  
**Prior:** Plan 11 rake/treasury (`docs/PLAN_11_RAKE_TREASURY.md`); WP-107 `/v1/metrics`  
**Date:** 2026-08-07  
**Frozen `/specs`:** untouched

---

## Goal

Instrument **actual per-hand COGS hooks** so Stage A can measure contribution margin:

```text
rake revenue − AI COGS − chain COGS − infrastructure COGS
  = protocol contribution
```

Season 1 still charges **poker rake only**. AI inference, VRF, relayer gas, proofs, and cloud infra remain internal COGS.

**Critical:** Season 1 rake schedule and COGS rates are labeled **`hypothesis`**. This packet does **not** silently freeze rake into GameTemplates.

---

## Delivered

| Item | Location |
|---|---|
| Groq token pricing + chain/VRF/relayer/cloud placeholders | `packages/unit-economics/src/pricing.ts` |
| Per-hand / per-session cost + contribution reports | `packages/unit-economics/src/hand-cost.ts` |
| Cost report CLI | `packages/unit-economics/src/cli.ts` (`pnpm economics:report`) |
| Groq `usage` capture on decide / background | `services/agent-runtime/src/provider/groq-gpt-oss-120b.ts` |
| Live economics ledger (+ optional JSONL) | `services/agent-runtime/src/live/economics.ts` |
| Metrics token counters (extends WP-107) | `services/agent-runtime/src/live/metrics.ts` |
| HTTP: enriched `/v1/metrics`, `/v1/economics`, `/v1/hand/end` | `services/agent-runtime/src/index.ts` |
| Game-server rake fan-out on `HAND_SETTLED` | `services/game-server/src/controllers.ts`, `table-runtime.ts` |
| Admin economics snapshot | `GET /v1/admin/economics` → `services/api/src/admin-economics.ts` |

---

## Aggregation path

```text
Groq chat completions `usage`
  → DecisionResult.tokenUsage
  → LiveTableMetrics (WP-107 + tokens)
  → EconomicsLedger (per-hand AI COGS via hypothesis rates)
  → + HAND_SETTLED.rake (game-server → /v1/hand/end or observe)
  → + chain/VRF/relayer/cloud placeholders (hypothesis)
  → @mozetto/unit-economics computeContribution / session report
  → GET /v1/economics | GET /v1/admin/economics | pnpm economics:report
```

Optional persistence: set `ECONOMICS_LEDGER_PATH` to append JSONL hand reports for offline CLI aggregation.

---

## Hypotheses (explicit)

| Surface | Status | Notes |
|---|---|---|
| Season 1 rake schedule | `hypothesis` | Unchanged — not a GameTemplate freeze |
| Groq $/MTok rates | `hypothesis` | `SEASON1_GROQ_TOKEN_PRICING_USD_MICRO_PER_MTOK` |
| Chain gas / VRF / relayer / cloud per hand | `hypothesis` | `SEASON1_CHAIN_INFRA_PLACEHOLDERS_USD_MICRO` |
| Energy AI cost bands | `hypothesis` | Existing Plan 11 bands |

Override placeholders via env (USD micro integers):

- `COGS_CHAIN_GAS_USD_MICRO`
- `COGS_VRF_USD_MICRO`
- `COGS_RELAYER_USD_MICRO`
- `COGS_CLOUD_USD_MICRO`

---

## Commands

```bash
# Unit economics + COGS report builders
pnpm --filter @mozetto/unit-economics test
pnpm economics:report -- --demo

# Agent-runtime (includes WP-111 ledger tests)
pnpm --filter @mozetto/agent-runtime test

# Live smoke → then inspect metrics/economics
pnpm smoke:groq-table -- --hands 3 --mode mock
# GET http://localhost:4002/v1/metrics
# GET http://localhost:4002/v1/economics
# GET http://localhost:4001/v1/admin/economics   # admin auth required
```

Offline ledger:

```bash
pnpm economics:report -- --ledger ./.data/economics-ledger.jsonl --session <sessionId>
```

---

## Admin / ops surfaces

| Endpoint | Role |
|---|---|
| `GET /v1/metrics` | WP-107 rates + WP-111 token totals + embedded economics snapshot |
| `GET /v1/economics?sessionId=` | Closed-hand contribution report |
| `POST /v1/hand/end` | Close hand with `rakeRevenue` |
| `GET /v1/admin/economics` | Treasury + agent-runtime COGS merge; freeze warning |

---

## Not in scope / deferred

- Calibrated Sepolia/mainnet COGS (replace placeholder rates from invoices / traces)
- Auto-freeze of Season 1 rake into GameTemplates / Safe-timelock activation
- Uncalled-bet rake eligibility (engine gap — Plan 11 deferred)
- Per-league high-stakes unit-econ acceptance pack (still required before fee freeze)
- Worker auto-`ProtocolFeeVault.sweep`

---

## Acceptance evidence

- Contribution identity reused from `@mozetto/unit-economics` `computeContribution`
- Groq tokens recorded when provider returns `usage` (mock/fallback → 0 tokens, noted)
- Rake wired from `HAND_SETTLED` without inventing fees
- Schedule/pricing status remains `hypothesis` in reports and admin payload
