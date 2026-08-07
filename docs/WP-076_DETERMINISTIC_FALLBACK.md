# WP-076 — Deterministic fallback

**Authority:** `mozetto_execution_plans/08_GROQ_GPT_OSS_120B_AI_RUNTIME.md` (Fallback controller), WP-076 in `16_AGENT_WORK_PACKETS.md`  
**Specs (frozen):** `specs/MOZETTO_CONTROLLER_V1.md` §8  
**Commitment label:** `deterministic-fallback-v1` → MODEL_POLICY_V1 `fallbackPolicyHash` (vector `10_model_policy_groq.json`)  
**Prior:** WP-070 stub; WP-071 model policy hash  
**Date:** 2026-08-07

---

## Delivered

| Item | Location |
|---|---|
| Priority policy + audit fields | `services/agent-runtime/src/provider/deterministic-fallback.ts` |
| DecisionResult audit extensions | `services/agent-runtime/src/provider/types.ts` |
| Default wire in Groq provider | `groq-gpt-oss-120b.ts` (`finishFallback` preserves selection reason) |
| HU / multi legal-set tests | `deterministic-fallback.test.ts` |
| Export | `@mozetto/agent-runtime/provider` |

---

## Priority policy (`deterministic-fallback-v1`, version `1`)

Pure function of the **legal action set**. Profiles, Energy, hole cards, and continuous cognition **MUST NOT** change the selection (Season 1: same fallback for every ranked seat).

| Order | If legal… | Amount | `reasonCode` / selection | `fallbackPriorityStep` |
|---:|---|---|---|---|
| 1 | CHECK | `"0"` | `FALLBACK_CHECK` (7) | `CHECK` |
| 2 | CALL | call `minAmount` | `FALLBACK_CALL` (8) | `CALL` |
| 3 | FOLD | `"0"` | `FALLBACK_FOLD` (9) | `FOLD` |
| 4 | BET / RAISE / ALL_IN | chosen action `minAmount` | `FALLBACK_SIZED` (10) | `SIZED_BET` / `SIZED_RAISE` / `SIZED_ALL_IN` |
| 5 | *(empty set)* | `"0"` fold | `FALLBACK_FOLD` + `errorClass: illegal_action` | `EMPTY_ILLEGAL` |

Sized step **4** uses fixed aggression order **BET → RAISE → ALL_IN** (not input array order). Amounts never exceed `minAmount` (never invent aggressive sizes).

Rationale (Plan 08): prefer check when free; prefer call over fold so a provider outage does not arbitrarily dump equity; keep sized fallback minimal and auditable.

---

## Audit trail

Every fallback `DecisionResult` stamps:

| Field | Meaning |
|---|---|
| `fallbackUsed` | `true` (CONTROLLER_V1 §8) |
| `fallbackPolicyId` | `"deterministic-fallback-v1"` |
| `fallbackPolicyVersion` | `1` |
| `fallbackPriorityStep` | which priority row fired |
| `fallbackSelectionReasonCode` | `FALLBACK_*` selection reason |
| `reasonCode` | same as selection on direct controller use |

When Groq remaps top-level `reasonCode` to `PROVIDER_ERROR_FALLBACK` (12) or `ILLEGAL_ACTION_FALLBACK` (13), **`fallbackSelectionReasonCode` is preserved** so audits can see both *why the provider failed* and *which legal action the policy chose*.

`responseNonce` is anti-collision only and MAY vary; `actionType` + `amount` + selection reason + policy version are deterministic for identical legal sets.

---

## Failure sequence (unchanged)

1. Primary Groq request  
2. One constrained schema-repair retry if time permits  
3. `DeterministicFallbackController` (this packet)  
4. Record failure + provider health impact  

---

## Season 1 hypotheses

| Knob | Value | Notes |
|---|---|---|
| Prefer CALL over FOLD always | yes | Safer than pot-odds fold; recalibrate only via new policy id/version |
| Sized size | always `minAmount` | No aggressive sizing under fallback |
| Observation / profile influence | none in v1 | Reserved; same fallback for all seats |

---

## Not in scope

- WP-073 continuous cognition scheduler  
- WP-074 Energy ledger charging  
- WP-075 public cadence (apply `@mozetto/agent-runtime/cadence` after decide)  
- Spec / golden vector mutations  
- Table pause-after-outage threshold (ops / later wave)
