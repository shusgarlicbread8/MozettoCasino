# WP-077 — Poker evaluation harness

**Authority:** `mozetto_execution_plans/08_GROQ_GPT_OSS_120B_AI_RUNTIME.md` (Model bake-off / Profile separation), WP-077 in `16_AGENT_WORK_PACKETS.md`  
**Prior:** WP-070 provider, WP-071 profiles, WP-072 state, WP-074 Energy, WP-076 fallback  
**Date:** 2026-08-07

---

## Delivered

| Item | Location |
|---|---|
| Scenario fixtures (HU + multi spots) | `services/agent-runtime/src/eval/scenarios.ts` |
| Profile-aware mock provider (CI-safe) | `services/agent-runtime/src/eval/mock-provider.ts` |
| Metrics (latency buckets, fallback, illegal, Energy, bb/100 stub, separation) | `services/agent-runtime/src/eval/metrics.ts` |
| Harness runner | `services/agent-runtime/src/eval/harness.ts` |
| CLI | `services/agent-runtime/src/eval/cli.ts` |
| Unit tests (mock-only, no live API) | `services/agent-runtime/src/eval/eval.test.ts` |
| Export | `@mozetto/agent-runtime/eval` |

---

## Runnable commands

```bash
# CI-safe default (ProfileMockProvider — no GROQ_API_KEY)
pnpm eval:poker
# equivalent:
pnpm --filter @mozetto/agent-runtime eval:poker

# More decisions / deterministic seed / JSON report
pnpm eval:poker -- --mode mock --decisions 56 --seed bakeoff-1 --json /tmp/wp077.json

# Fault injection (measures fallback rate)
pnpm eval:poker -- --mode mock --fault-rate 0.25

# Optional live Groq (requires GROQ_API_KEY; not used in CI)
pnpm eval:poker -- --mode live --decisions 28
```

Unit tests covering the harness are included in:

```bash
pnpm --filter @mozetto/agent-runtime test
# or root:
pnpm test:unit
```

---

## Metrics

| Metric | Meaning |
|---|---|
| Latency buckets | Histogram + p50/p95/p99 of `providerLatencyMs` |
| Fallback rate | Fraction of decisions with `fallbackUsed=true` |
| Illegal-action rate | Fraction with `errorClass=illegal_action` / `ILLEGAL_ACTION_FALLBACK` |
| Energy spend | WP-074 ledger: `STANDARD_FINAL_DECISION` (8) per decide; grant 100 / hand |
| bb/100 stub | Scenario-weighted EV proxy × 100 — **not** full-session equity |
| Profile separation | Total-variation (L1/2) distance of action histograms across presets |
| VPIP / PFR / aggression | Proxies from scenario actions (Plan 08 separation axes) |

Default mock separation threshold: `minPairwiseL1 ≥ 0.08` (CLI exits non-zero if unmet when `faultRate=0`).

---

## Modes

| Mode | Provider | API key | CI |
|---|---|---|---|
| `mock` (default) | `ProfileMockProvider` — axes-biased deterministic mock + optional fault injection | Not required | Yes |
| `live` | `GroqGptOss120BProvider` | `GROQ_API_KEY` required | No |

Mock faults route through `DeterministicFallbackController` (`deterministic-fallback-v1`) so reliability metrics exercise the WP-076 path.

---

## Product rules

- Offline / evaluation only — does **not** start continuous cognition (WP-073).
- Public cadence clamping remains WP-075; harness records placeholder `publicCadenceMs` from mocks.
- Live bake-off SLOs (tens of thousands of decisions, full HU/six-max sessions) are out of scope for this packet; the harness is the measurement surface.

---

## Not in scope

- WP-073 continuous cognition scheduler / priority queue
- Spec / golden vector mutations
- Full engine session EV (bb/100 is a stub)
- Requiring live Groq in default CI
