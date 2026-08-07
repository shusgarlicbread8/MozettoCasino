# WP-107 — Live Groq AI table integration

**Authority:** Plan 08 / Plan 09; WP-107 in `mozetto_execution_plans/16_AGENT_WORK_PACKETS.md`  
**Prior:** WP-070–077 (provider, policy, AgentState, Energy, cadence, cognition, fallback, eval)  
**Date:** 2026-08-07

---

## Delivered

| Item | Location |
|---|---|
| Live session manager (cognition → Energy → decide → cadence) | `services/agent-runtime/src/live/session-manager.ts` |
| Metrics stubs (illegal / fallback / Energy/hand / latency) | `services/agent-runtime/src/live/metrics.ts` |
| Mode + cadence wait env | `services/agent-runtime/src/live/mode.ts` |
| Multi-hand HU smoke harness + CLI | `services/agent-runtime/src/live/table-smoke.ts`, `cli.ts` |
| HTTP: `/v1/act`, `/v1/observe`, `/v1/hand/begin`, `/v1/metrics` | `services/agent-runtime/src/index.ts` |
| Game-server `AgentRuntimeController` + observe fan-out | `services/game-server/src/controllers.ts`, `table-runtime.ts` |
| Env docs | `.env.example` |
| Export | `@mozetto/agent-runtime/live` |

---

## Integration path

```text
game-server (public event persist)
  → POST agent-runtime /v1/observe   (permitted observation; no hole cards / CoT)
  → ContinuousCognitionScheduler.onPublicEvent + drain (Energy-aware background)

game-server (seat to act, HUMAN_PLAY=0)
  → POST agent-runtime /v1/act
       → preempt background
       → provider.decide (Groq live | ProfileMock mock)
       → validate legal action (fallback WP-076)
       → debit Energy (WP-074)
       → schedule publicCadenceMs (WP-075)
  → game-server waits cadenceWaitMs on table clock
  → commit applyAction → canonical / hand_events
```

Private AgentState and Energy ledgers stay in agent-runtime. Clients only see public actions + cadence — **never** chain-of-thought.

---

## Env flags

| Variable | Default | Meaning |
|---|---|---|
| `GROQ_API_KEY` | unset | Live Groq; **never commit** |
| `AGENT_RUNTIME_MODE` | `auto` | `auto` \| `mock` \| `live` |
| `AGENT_STATE_STORE` | `memory` | `memory` \| `db` (migration 026) |
| `ENERGY_LEDGER_STORE` | `memory` | `memory` \| `db` |
| `AGENT_CADENCE_WAIT` | `client` | `client` (game-server sleeps) \| `server` \| `off` |
| `AGENT_CADENCE_WAIT_CAP_MS` | unset | Optional smoke cap |
| `AI_CONTROLLER` | `agent-runtime` | Seat controller kind |
| `HUMAN_PLAY` | `1` | Set `0` for autonomous AI tables |
| `AGENT_RUNTIME_URL` | `http://localhost:4002` | Game-server → runtime |
| `AGENT_RUNTIME_OBSERVE` | on | Set `0` to disable observe fan-out |

Store factories: `createAgentStateStore` / `createEnergyLedgerStore` — WP-107 respects the same selection as WP-072/074.

---

## Smoke / harness (multi-hand + 100+)

CI-safe mock (no API key):

```bash
pnpm smoke:groq-table -- --hands 3 --mode mock
# or:
pnpm --filter @mozetto/agent-runtime smoke:groq-table -- --hands 3 --mode mock
```

**100+ hands (mock — recommended for load / metrics):**

```bash
pnpm smoke:groq-table -- --hands 100 --mode mock --quiet
```

**100+ hands (live Groq — costs real tokens; key from `.env.local` only):**

```bash
# Ensure GROQ_API_KEY is in gitignored .env.local — never echo or commit it.
pnpm smoke:groq-table -- --hands 100 --mode live --profiles shark,professor
```

Optional cadence exercise (slower):

```bash
pnpm smoke:groq-table -- --hands 10 --mode mock --cadence
```

Unit coverage (mock path):

```bash
pnpm --filter @mozetto/agent-runtime test
```

### Hosted / local game-server AI table

```bash
# terminal A
HUMAN_PLAY=0 AGENT_RUNTIME_MODE=auto pnpm dev:agent

# terminal B
HUMAN_PLAY=0 AI_CONTROLLER=agent-runtime pnpm dev:game
```

Then seat AI profiles and run hands; game-server calls `/v1/hand/begin`, `/v1/observe`, `/v1/act`.

Metrics: `GET http://localhost:4002/v1/metrics` → illegal-action rate, fallback rate, Energy/hand, latency p50/p95.

---

## Metrics hooks (stubs)

`LiveTableMetrics` records:

| Metric | Field |
|---|---|
| Illegal-action rate | `illegalActionRate` |
| Fallback rate | `fallbackRate` |
| Energy / hand | `energyPerHand` |
| Latency | `latency.meanMs` / `p50Ms` / `p95Ms` |

Injectable `LiveMetricsHook.onDecision` / `onHandBegin` / `onHandEnd`. WP-111 wires token/COGS via `EconomicsLedger` — see `docs/WP-111_ECONOMICS_INSTRUMENTATION.md`.

---

## Product rules

- Observation to cognition is **structured / public** only — hole cards only on the acting seat’s private `/v1/act` observation, never on `/v1/observe`.
- Response JSON MUST NOT include free-form reasoning or CoT.
- Deterministic fallback (`deterministic-fallback-v1`) remains the Groq failure path.
- Ranked Season 1 model remains `openai/gpt-oss-120b` via Groq.

---

## Not in scope

- Spec / golden vector mutations
- WP-106 full Anvil browser golden path
- WP-108 real settlement roots (separate packet)
- Committing `GROQ_API_KEY`
- Calibrated Sepolia COGS rates (WP-111 hypotheses until traces)
