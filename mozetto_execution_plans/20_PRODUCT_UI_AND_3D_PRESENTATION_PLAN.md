# 20 — Product UI and 3D Presentation Plan

**Priority:** Begin after the protocol flow is stable enough to expose real states.  
**Goal:** Make Mozetto feel like a mass-market competitive game, not a trading terminal, without allowing the visual layer to become authoritative.

## Product hierarchy

The default player loop is:

```text
Play
→ choose league/buy-in
→ choose/tune strategy profile
→ Find Match
→ funds lock and match verifies
→ watch autonomous AI play
→ see result and verification
→ rematch or leave
```

Do not make “build an agent” the mandatory first action.

## Navigation

Recommended launch navigation:

```text
Home
Play
Watch
Rankings
My AI
Replays
Wallet
Verify
Settings
```

Advanced protocol/admin information stays accessible but does not dominate the consumer experience.

## Home

Lead with:

- Play Now;
- league selection;
- live matches;
- active session status;
- wallet/ArenaAccount balance;
- recent results;
- rankings/rivalries.

Do not lead with token counts, raw contract fields, or a marketplace.

## Find Match overlay

Inputs:

- game template;
- league/buy-in;
- profile preset;
- bounded profile sliders;
- permission/cap status;
- maximum at-risk summary.

Show:

```text
Buy-in locked only when a match is formed
One standardized AI engine
100 Energy per hand
Published capped rake
Random opponent allocation
Provably committed deck process
```

Primary button:

```text
FIND MATCH
```

The first seamless-play grant is explained once. Subsequent matching should be popup-free within permission limits.

## Strategy profiles

Use strong visual identities:

- Shark — pressure/aggression;
- Fox — adaptation/deception;
- Professor — patience/depth;
- Machine — balance/consistency.

Sliders are understandable traits, not technical model settings:

```text
Aggression
Risk
Adaptation
Deception
Tempo
Energy discipline
```

Show trade-offs, not claims of guaranteed profitability.

## Live table

### Public information

- cards/board allowed by rules;
- pot/stacks;
- public actions;
- action timer;
- dealer/button/blinds;
- table/session verification state;
- public player aliases;
- current profile avatar after reveal policy, if allowed.

### Owner information

- own Agent status (`observing`, `updating model`, `decision ready`, `acting`);
- own Energy meter/summary;
- no raw chain-of-thought;
- private cards only if the ranked anti-collusion policy permits them. Default multiplayer recommendation: do not reveal live to owner.

### Opponent information not shown

- private AgentState;
- reasoning;
- Energy details unless globally public by policy;
- profile/model if hidden until settlement;
- provider latency;
- hole cards.

## Simple and Analysis views

### Simple — default

- clean table;
- animated actions;
- understandable AI state;
- pot and result;
- concise verification badge.

### Analysis — post-hand or advanced

- action timeline;
- public timing;
- Energy usage;
- profile behavior summary;
- public probabilities only if computed honestly and labelled;
- card proofs;
- event/root inclusion;
- replay.

Do not expose live bluff probabilities or raw reasoning that opponents could exploit.

## Verification UX

Every active/finished session has a clear state:

```text
Funds locked on Base
Players sealed
VRF requested/fulfilled
Deck batch committed
Events anchored
Settlement pending/confirmed
```

The Verify Game page expands into technical detail and local verification.

Avoid a generic “provably fair” label without showing which components are actually verified.

## 3D character direction

3D avatars are a presentation layer driven by canonical events.

Examples:

- Shark leans forward on aggressive raise;
- Professor studies board during cadence delay;
- Fox varies expressions/timing;
- Machine remains precise/consistent.

The animation engine consumes:

```text
event type
public cadence
profile preset
pot class
hand/result state
```

It never influences the action or reveals private state.

## 3D pipeline

Suggested layers:

```text
React/Next table shell
→ WebGL/Three.js or game-rendering layer
→ reusable avatar rig
→ profile animation state machine
→ canonical-event adapter
```

Start with one shared rig and profile skins rather than five unrelated high-cost characters.

Performance requirements:

- graceful 2D fallback;
- mobile quality tiers;
- no delay to canonical action display;
- spectator scalability;
- asset CDN/versioning;
- accessibility/reduced motion.

## Spectator mode

- delayed stream for high-value ranked games;
- no private cards before legal reveal;
- commentary generated from public events only;
- no private AI state;
- featured matches selected after session allocation, not as joinable targets;
- shareable hand highlights after verification.

## Wallet presentation

Show:

```text
ArenaAccount balance
currently locked
pending settlement
available to play
```

Avoid implying that Mozetto owns idle funds.

Withdraw/fund actions belong to ArenaAccount ownership flow.

## Mobile

- one-handed Find Match;
- compact profile tuning;
- clear locked/available balance;
- table view prioritizes board/pot/action state;
- Energy/status collapsible;
- verification summary accessible without overwhelming play.

## Product safety/accuracy

- no fake live player counts/prize pools in production;
- no hardcoded rankings fallback;
- no claim that AI guarantees wins;
- use “provably fair cards” and “strategic competition,” not “pure skill with no luck”;
- distinguish Anvil/Sepolia mUSDC from real USDC unmistakably.

## Implementation stages

1. Replace design-runtime HTML with typed React components.
2. Wire real matchmaking/session lifecycle states.
3. Wire real balances and verification status.
4. Build simple live table.
5. Build post-hand analysis/replay.
6. Add public Verify Game.
7. Add profile animation state machine.
8. Add 3D avatar prototype with 2D fallback.
9. Load/performance test spectator mode.
10. Polish only after backend states are truthful.

## Acceptance checklist

- [ ] UI never calculates authoritative poker state.
- [ ] Every displayed balance has a named source.
- [ ] Match state maps exactly to protocol lifecycle.
- [ ] Opponent private information never leaks.
- [ ] Profile tuning is bounded and hashed before seal.
- [ ] Verification status is precise, not decorative.
- [ ] 3D layer can fail without affecting gameplay.
- [ ] Mobile and reduced-motion paths work.
