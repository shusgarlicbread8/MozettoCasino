# 04 — Game Registry, Session Lifecycle, and Matchmaking

**Entry gate:** Custody primitives and canonical session descriptors are frozen.  
**Exit gate:** Ranked participants, seats, controllers, and rules cannot change after sealing.

## Game template registry

Do not deploy a new custody contract for every game. Register immutable game templates that all use the same custody/session protocol.

```solidity
struct GameTemplateV2 {
    bytes32 gameId;
    bytes32 rulesHash;
    bytes32 engineHash;
    bytes32 deckSpecHash;
    bytes32 controllerPolicyHash;
    bytes32 energyPolicyHash;
    bytes32 randomnessPolicyId;
    bytes32 settlementPolicyId;
    uint8 minSeats;
    uint8 maxSeats;
    uint64 actionClockMs;
    uint16 rakeBps;
    uint128 rakeCap;
    bool noFlopNoDrop;
    bool rated;
    bool enabled;
}
```

Initial templates:

```text
NLHE_HU_STANDARD_SEASON_1
NLHE_6MAX_CLASSIC_SEASON_1
```

Each template references the exact Groq model policy and allowed profile set for Season 1.

## Registry governance

- New templates require Protocol Safe approval and timelock.
- Active template fields are immutable.
- A template may be disabled for new sessions without invalidating history.
- Each public manifest includes rules, engine commit, test vectors, rake, energy policy, and controller policy.
- The Verify Game page resolves these hashes to human-readable artifacts.

## Session lifecycle

```text
DRAFT
  ↓
SEALED
  ↓
RANDOMNESS_PENDING
  ↓
READY
  ↓
ACTIVE
  ↓
SETTLING
  ↓
SETTLED
```

Additional terminal/recovery states:

```text
ABORTED_BEFORE_ACTIVE
PAUSED_AFTER_HAND
UNDER_REVIEW
EMERGENCY_EXIT_AVAILABLE
EMERGENCY_EXITED
```

### DRAFT

Allowed:

- tickets collected;
- random matchmaking decisions;
- funds checked/reserved;
- participants replaced if a ticket expires before atomic lock.

Not allowed:

- cards;
- VRF binding;
- rating effect;
- active play.

### SEALED

Freeze:

- ArenaAccounts;
- owner identities;
- seat assignments;
- buy-ins;
- profile hashes;
- model policy hash;
- game template;
- rated pool;
- participant root;
- opening balance root.

No participant replacement after this point.

### RANDOMNESS_PENDING

- dealer secret root already exists;
- VRF request is created and bound to session/epoch;
- no reroll, cancellation, or alternate fulfillment;
- the session cannot accept new outcome-affecting inputs.

### READY

- VRF fulfilled;
- deck-batch root committed;
- dealer attestation valid;
- controllers healthy;
- game-server actor elected;
- complete session state recoverable.

### ACTIVE

- only canonical poker events may advance state;
- joins/leaves are queued for an epoch boundary;
- strategy/profile/model changes rejected;
- user coaching commands are stored for a later session only.

### SETTLING

- no more game actions;
- final roots produced;
- replay verification and attestation underway;
- funds remain locked.

### SETTLED

- final ArenaAccount payouts complete;
- rake accrued;
- rating update may execute;
- proof package published.

## Ranked matchmaking policy

Ranked public users choose:

- game;
- league/buy-in;
- strategy profile;
- permitted custom axes.

They do **not** choose:

- exact table;
- exact opponent;
- seat;
- dealer button;
- public room identifier before allocation.

The matchmaker chooses randomly within constraints:

1. same chain/mode;
2. same game template;
3. same league/buy-in;
4. compatible rating band;
5. acceptable latency region;
6. no linked-account exclusion;
7. repeated-pair limits;
8. reliability threshold;
9. randomized seat order.

## HU policy

For rated HU:

- use ephemeral sessions;
- equal opening stacks;
- standardized match length/end condition;
- one account may have one rated HU session active initially;
- same pair receives full rating weight only within defined caps;
- model/profile hidden during play if desired, but committed before seal.

## Six-max policy

For six-max:

- random fill to target seats;
- start threshold is a product decision; for ranked six-max use full seats or a documented minimum;
- no direct public table selection;
- same beneficial owner cannot occupy multiple seats;
- linked wallets are blocked or isolated from rating;
- new joins occur only in a new epoch between hands.

## Cash-table epoch rotation

For a continuous table:

```text
Hand N ACTIVE
→ queued join/leave/top-up changes
→ Hand N completes
→ current checkpoint closes
→ settle/rebase current epoch as required
→ seal Epoch N+1 participant and balance roots
→ bind next randomness range
→ Hand N+1 starts
```

A user requesting leave during a hand remains exposed until the hand finishes. An all-in user cannot leave before resolution.

## Private tables

Private/custom tables are a separate class:

- unranked by default;
- clearly marked;
- invite-based;
- may expose table selection;
- do not pollute public rating or liquidity metrics;
- still use custody, randomness, and proof requirements if funds are involved.

## Anonymous live identity

During ranked sessions, display temporary aliases or seat labels. Reveal public owner/profile details after the session according to product policy.

This reduces targeting, collusion coordination, and model/profile inference.

## Matchmaking data model

Add/normalize:

```text
matchmaking_intents
seat_tickets_v3
matchmaking_batches
session_drafts
session_participants
session_epochs
queued_seat_changes
pairing_history
identity_clusters
matchmaking_exclusions
```

Each matchmaking decision stores a reason trace sufficient for audit without exposing anti-fraud secrets publicly.

## APIs

```text
POST /v1/matchmaking/intents
DELETE /v1/matchmaking/intents/:id
GET /v1/matchmaking/status/:id
POST /internal/matchmaking/build-session
POST /internal/sessions/:id/seal
GET /v1/sessions/:id/public
POST /v1/sessions/:id/request-leave
POST /v1/sessions/:id/queue-profile-for-next-session
```

No client endpoint directly changes a session from SEALED onward.

## Failure handling

### Player disappears before seal

Remove ticket and continue matching.

### Relayed lock transaction fails

Return to DRAFT; no cards or rating.

### VRF delayed

Remain RANDOMNESS_PENDING; show status; do not reroll.

### Controller unhealthy before active

Abort before active and unlock all funds.

### Controller outage during active

Use deterministic fallback for the immediate action; pause between hands if outage threshold is exceeded.

### Game server failure

Recover from the last persisted canonical event; do not create a parallel actor.

## Acceptance tests

- same owner cannot occupy two ranked seats;
- participants cannot be swapped after seal;
- an expired ticket cannot seal;
- seat order is deterministic from recorded matchmaking output but not chosen by user;
- new player cannot enter mid-hand;
- queued leave happens after hand;
- continuous table creates a new epoch;
- VRF cannot be requested before seal;
- active profile hash cannot be changed;
- private games never update ranked rating by default.
