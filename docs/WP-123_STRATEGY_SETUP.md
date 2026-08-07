# WP-123 — Strategy setup

**Authority:** Plan `20_PRODUCT_UI_AND_3D_PRESENTATION_PLAN.md` (Plan 20A), packet `16_AGENT_WORK_PACKETS.md` WP-123, runtime presets WP-071  
**Date:** 2026-08-07  
**Status:** DONE

---

## Delivered

| Item | Location |
|---|---|
| Strategy setup UI (profiles + bounded traits + behavioral preview) | `apps/web/src/components/strategy/StrategySetup.tsx` |
| Routes `/my-ai`, `/my-ai/setup` | `apps/web/src/app/(app)/my-ai/` |
| Preset / trait / hash helpers (mirrors agent-runtime Season 1) | `apps/web/src/lib/strategy-profiles.ts` |
| Client draft store (profileKey + traits) | `apps/web/src/lib/strategy-store.ts` |
| Find Match wires preferred profile + shows lock hash | `apps/web/src/components/ArenaFindMatch.tsx` |
| This note | `docs/WP-123_STRATEGY_SETUP.md` |

No `/specs` mutations. No free-text prompt / CoT editor.

---

## Goal

Mass-market strategy setup: choose Shark / Fox / Professor / Machine, nudge bounded traits, see a **behavioral** preview (trade-offs, not ROI), and understand that `profileConfigHash` locks at Find Match.

---

## Profiles

| Key | Intent | `presetId` preimage |
|---|---|---|
| `shark` | Pressure / aggression | `PRESET_SHARK` |
| `fox` | Adaptation / deception | `PRESET_FOX` |
| `professor` | Patience / depth | `PRESET_PROFESSOR` |
| `machine` | Balance / consistency | `PRESET_MACHINE` |

Axis defaults mirror `services/agent-runtime/src/policy/presets.ts` (Shark = golden vector 09).

---

## Consumer traits → protocol axes

Plan 20A labels map onto CONTROLLER_V1 axes:

| UI trait | Protocol axis |
|---|---|
| Aggression | `aggression` |
| Risk | `riskTolerance` |
| Adaptation | `opponentAdaptation` |
| Deception | `deception` |
| Tempo | `tempo` |
| Energy discipline | `energyConservation` |

`trapPreference` and `variancePreference` stay at preset defaults (not exposed in Season 1 consumer UI).

Envelope: **±25** from preset, clamped to `0..100` (WP-071 Season 1 hypothesis).

---

## Hash lock at Find Match

1. User saves strategy → `profileKey` PATCH `/v1/me/agent` + local draft (`mz.strategy.v1`).
2. Find Match / seat ticket uses `profileKey` → `getAgentProfileHash` → `agent_profile_versions.profile_hash`.
3. That value is written as seat-ticket **`profileConfigHash`** (and V2 `agentProfileHash`) at queue entry.

Season 1 seed hashes (sha256 of `${KEY}_V1`), shown in the UI:

| Key | `profileConfigHash` |
|---|---|
| shark | `0x25af13b8…e01f9` |
| fox | `0x75102f40…f6132` |
| professor | `0x24326d31…c77db` |
| machine | `0xa531969a…aad96` |

`presetId` values are CONTROLLER_V1 keccak256 preimages (`PRESET_*`). Full PROFILE_V1 hashing with axis envelopes already exists in agent-runtime (`hashProfileConfig`); the queue path still binds the Season 1 seed hash by `profileKey`. Trait deltas preview locally until the API accepts typed axes on find-match.

---

## Explicit non-goals

- Free-text strategy / coaching prompts in ranked Season 1
- Chain-of-thought editor
- Guaranteed-return or EV claims in preview copy
- Spec / golden-vector mutations
- Multi-model picker

---

## Commands / evidence

```bash
pnpm --filter @mozetto/web typecheck
```

---

## Follow-up

- WP-122 continues Play IA polish; keep Tune → `/my-ai` link
- Accept typed axis envelopes on find-match / seat ticket when promoting full PROFILE_V1 hashes
- Migrate remaining Find Match palette onto WP-120 tokens (shared with WP-122)
