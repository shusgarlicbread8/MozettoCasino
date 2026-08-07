# WP-071 — Master policy and profile system

**Authority:** `mozetto_execution_plans/08_GROQ_GPT_OSS_120B_AI_RUNTIME.md`, WP-071 in `16_AGENT_WORK_PACKETS.md`  
**Specs (frozen):** `specs/MOZETTO_CONTROLLER_V1.md`, vectors `09_profile_hash.json`, `10_model_policy_groq.json`  
**Date:** 2026-08-07

---

## Delivered

| Item | Location |
|---|---|
| Master poker policy (Season 1 text + frozen commitment hash) | `services/agent-runtime/src/policy/master-policy.ts` |
| Four presets: Shark / Fox / Professor / Machine | `services/agent-runtime/src/policy/presets.ts` |
| Bounded axes `0..100` + Season 1 envelope (±25 hypothesis) | `services/agent-runtime/src/policy/axes.ts`, `profile.ts` |
| PROFILE_V1 hashing via `@mozetto/protocol-vectors` | `profile.ts` → matches vector 09 |
| MODEL_POLICY_V1 + `modelPolicyHash` | `model-policy.ts` → matches vector 10 |
| Groq system prompt uses master policy + typed profile axes | `services/agent-runtime/src/provider/groq-gpt-oss-120b.ts` |
| Unit tests vs golden vectors | `services/agent-runtime/src/policy/policy.test.ts` |

---

## Product rules (Season 1)

- One master policy for all ranked seats; profiles are **typed data**, not separate free-text prompts.
- Players select a preset + bounded slider overrides; **no multi-model UI**.
- `toolsDisabled` MUST remain `true`.
- Continuous cognition loops are **not** started here (WP-073).

---

## Frozen hashes (do not silently mutate)

| Commitment | Preimage label | Role |
|---|---|---|
| `masterPolicyHash` | `master-poker-policy-season1-v1` | Field inside MODEL_POLICY_V1 |
| `profileSetHash` | `profile-set-season1-v1` | Field inside MODEL_POLICY_V1 |
| `modelPolicyHash` | full ABI encode (vector 10) | Seat ticket / settlement binding |
| Shark `presetId` | `PRESET_SHARK` | PROFILE_V1 |
| Profile example (Alice) | vector 09 axes + `profile-alice-shark-1` | PROFILE_V1 golden |

Changing master-policy **prose** does not retarget the frozen `masterPolicyHash` label. Launch a new engine season / policy version to recalibrate.

---

## Season 1 hypotheses (empirical defaults)

Mark these as hypotheses until bake-off / WP-077 separation tests:

| Knob | Value | Notes |
|---|---|---|
| `temperatureMilli` | `0` | Vector 10 / CONTROLLER_V1 |
| `maxOutputTokens` | `256` | Vector 10 |
| Fox / Professor / Machine axis defaults | see `presets.ts` | Shark axes match vector 09 |
| Axis customization envelope | ±25 from preset | Server-validated |
| `allowedSchedulerWeights` | `0x00ff00ff` | Shared Season 1 mask (vector 09) |
| Reasoning effort | `low` (provider) | WP-070; not part of PROFILE_V1 |

---

## Not in scope

- WP-073 continuous cognition scheduler
- WP-074 Energy ledger charging
- WP-075 public cadence (see `docs/WP-075_PUBLIC_CADENCE_CONTROLLER.md`)
- Multi-model selection UI
- Spec / golden vector mutations
