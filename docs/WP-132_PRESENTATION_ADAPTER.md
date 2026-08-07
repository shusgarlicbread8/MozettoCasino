# WP-132 — Presentation event adapter (3D-ready, no art)

**Authority:** Plan `20_PRODUCT_UI_AND_3D_PRESENTATION_PLAN.md` (adapter layer only), packet `16_AGENT_WORK_PACKETS.md` WP-132  
**Date:** 2026-08-07  
**Status:** DONE  

**Plan 20B (full 3D production) remains `DEFERRED`.** This packet ships mapping + tokens only — no Unity, R3F, meshes, or avatar art.

---

## Delivered

| Item | Location |
|---|---|
| Package `@mozetto/presentation-adapter` | `packages/presentation-adapter/` |
| Mapping table (kind × profile → avatar state) | `src/mapping.ts` (`AVATAR_STATE_MAP`) |
| Unit tests | `src/presentation-adapter.test.ts` |
| Thin WP-125 table hook | `apps/web/src/lib/table-presentation.ts` (+ `use-table-feed` / `data-avatar-state` when WP-125 module present) |
| This note | `docs/WP-132_PRESENTATION_ADAPTER.md` |

No `/specs` mutations. No protocol / settlement changes.

---

## Pipeline

```text
Canonical Poker Event (PokerEventV1 code or table wire action)
  → Presentation Event (kind + profile + potClass + publicCadenceMs)
  → Avatar State (e.g. PLAYER_RAISED + shark → lean_forward_aggressive)
```

Consumers:

- **2D table (WP-125 now):** attach `avatarState` / `data-avatar-state` on action bubbles.
- **Future 3D (Plan 20B):** same tokens drive a profile animation state machine; adapter never delays canonical action display.

---

## Inputs (public only)

| Field | Role |
|---|---|
| `eventType` / `action` | PokerEventV1 code or fold/check/call/bet/raise/all_in |
| `profile` | shark / fox / professor / machine (WP-071 / WP-123) |
| `pot` + `bigBlind` | pot-class classification (micro→all_in) |
| `publicCadenceMs` | optional cadence context (presentation timing only) |
| `handResult` | win / loss / chop / abort override after end/showdown |

The adapter **must not** consume private AgentState, CoT, provider latency, or hole cards.

---

## Golden examples (Plan 20)

| Presentation | Profile | Avatar state |
|---|---|---|
| `PLAYER_RAISED` | shark | `lean_forward_aggressive` |
| `CADENCE_WAIT` | professor | `study_board` |
| `PLAYER_RAISED` | fox | `subtle_shift` (→ `bet_press` on large pot) |
| `PLAYER_RAISED` | machine | `precise_commit` |

---

## API

```ts
import { adaptCanonicalToAvatar } from "@mozetto/presentation-adapter";

const { event, avatarState, label } = adaptCanonicalToAvatar({
  action: "raise",
  profile: "shark",
  pot: 120,
  bigBlind: 2,
});
// avatarState === "lean_forward_aggressive"
```

Table helper:

```ts
import { presentationFromTableAction } from "@/lib/table-presentation";
```

---

## Commands

```bash
pnpm --filter @mozetto/presentation-adapter test
pnpm --filter @mozetto/presentation-adapter typecheck
```

---

## Out of scope / follow-up

- Plan **20B** full 3D production (rigs, skins, CDN assets, quality tiers) — **deferred**
- Wiring seat `profile_key` from API into every `PLAYER_ACTED` payload (defaults to `machine` when omitted)
- WP-126 cognition presentation chrome (separate packet)
- Spec mutations
