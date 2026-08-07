# 06 — Poker Engine Rules and Rust Canonical Core

**Entry gate:** Poker event and amount/card encodings are frozen.  
**Exit gate:** Rust, TypeScript, and PokerKit agree across comprehensive deterministic and generated tests.

## Strategy

Do not discard the working TypeScript NLHE engine. Treat it as the current production implementation and a differential oracle. Build the Rust engine in parallel, prove parity, then promote Rust deliberately.

## Core design principle

The poker engine is a pure deterministic transition function:

```text
CurrentState + LegalAction → NextState + CanonicalEvents
```

It performs no:

- database access;
- HTTP;
- WebSockets;
- blockchain calls;
- randomness generation;
- AI inference;
- wall-clock reads;
- floating-point arithmetic.

External systems supply the deck and action. The engine validates and applies them.

## Rust workspace

```text
crates/
  poker-core/
  poker-eval/
  poker-events/
  poker-replay/
  poker-wasm/
  poker-test-vectors/
```

### `poker-core`

- table state;
- seat state;
- blind/button logic;
- street transitions;
- legal actions;
- bet/raise rules;
- all-ins;
- side pots;
- showdown;
- rake hooks;
- deterministic state hash.

### `poker-eval`

- five-card evaluator;
- seven-card Hold'em evaluator;
- tie ordering;
- test vectors.

### `poker-events`

- canonical event types and encoders;
- no business-specific database fields.

### `poker-replay`

- reconstruct state from opening descriptor + deck + event list;
- detect sequence/hash divergence.

### `poker-wasm`

- browser/CLI verification build;
- no private dealer data required for public replay verification.

## Initial supported formats

### NLHE Heads-Up

- exactly two active seats;
- dealer posts small blind;
- non-dealer posts big blind;
- dealer acts first preflop and last postflop;
- button alternates correctly after completed hand;
- all HU edge cases explicitly tested.

### NLHE Six-Max

- two to six active seats for cash implementation;
- ranked product may require a stricter start count;
- dead/sitting-out seats handled explicitly;
- button/blinds move according to frozen table policy;
- seat changes only between hands/epochs.

## Rule modules

### State

```text
TableState
HandState
SeatState
BettingRoundState
PotState
DeckCursor
ActionContext
```

### Legal actions

The engine must produce an exact set:

```text
fold
check
call(amount)
bet(min..max)
raise(toAmount min..max)
all-in
```

Use one unambiguous amount convention. Recommended: raise amounts represent total committed amount for the current street, not incremental chips, because it reduces ambiguity in logs.

### Raise rules

Cover:

- minimum opening bet;
- minimum full raise;
- all-in below full raise;
- incomplete raise that does not reopen action;
- multiple incomplete all-ins;
- players who already acted;
- heads-up final-action behavior;
- maximum no-limit raise.

### Pots

- main pot;
- arbitrary side pots;
- folded contributions remain in pots;
- eligibility sets;
- split pots;
- odd-chip policy;
- uncalled bet return;
- rake only from eligible settled pot under template policy.

### Showdown

- fold win;
- all-in runout;
- hand evaluation;
- tie distribution;
- showdown order as display metadata;
- proof events for revealed cards.

### Rake hook

The engine receives immutable `RakePolicy` from the game template:

```text
rakeBps
rakeCapBaseUnits
noFlopNoDrop
minimumEligiblePot optional
```

It emits `RAKE_DEDUCTED` and conserves the hand:

```text
opening stacks + posted amounts == ending stacks + rake
```

## Required edge-case suite

At minimum:

- preflop everyone folds to big blind;
- heads-up small blind folds;
- short-stack blind all-in;
- all players all-in preflop;
- three-way side pots;
- nested side pots;
- incomplete all-in raise;
- incomplete raise after prior action;
- exact call all-in;
- uncalled raise return;
- board tie;
- three-way split with odd chip;
- player leaves after hand;
- player joins next epoch;
- sitting-out blind behavior;
- duplicate card rejection;
- wrong deck length;
- invalid actor;
- stale action sequence;
- timeout fallback action;
- action at deadline boundary;
- button rotation after bust/leave;
- stack cannot become negative;
- rake cap and no-flop-no-drop.

## PokerKit reference strategy

Use PokerKit as an independent reference oracle, not as the production runtime.

Create generators that output scenarios consumable by:

- current TypeScript engine;
- Rust engine;
- PokerKit tool.

Compare:

```text
legal action set
minimum/maximum raise
street transitions
pot construction
winners
payouts
rake
final state hash
```

Where PokerKit policy differs from Mozetto's explicitly chosen room rule, document the divergence and test the Mozetto rule independently.

## Differential fuzzing

Use property-based generators for:

- seat counts;
- starting stacks;
- blind values;
- legal action sequences;
- all-in patterns;
- deck permutations;
- joins/leaves at legal boundaries.

Targets:

- millions of states in CI/nightly runs;
- shrinking to minimal failing scenarios;
- deterministic seed recording.

## State hash

Every state transition produces a canonical state hash that excludes non-consensus metadata such as display names or server timestamps.

The replay verifier must reach the same hash from:

```text
opening state + committed deck openings + canonical actions
```

## Promotion plan

1. Freeze current TS behavior.
2. Implement Rust HU.
3. Reach HU parity.
4. Implement Rust six-max.
5. Reach six-max parity.
6. Run shadow mode: TS authoritative, Rust replays every live test hand.
7. Alert on divergence.
8. Run public Sepolia shadow period.
9. Promote Rust to authoritative engine through a new `engineHash` and game-template version.
10. Keep TS verifier for a deprecation window.

## Future extensibility

Design card/deck and betting traits so later variants can reuse infrastructure:

- Pot-Limit Omaha;
- Short Deck;
- tournaments;
- multiple runouts if ever approved.

Do not introduce variant abstractions that destabilize NLHE before parity. Add them after the core is frozen and tested.

## Acceptance checklist

- [ ] Pure engine has no I/O or nondeterminism.
- [ ] Every action is validated by engine, never trusted from AI/client.
- [ ] HU and six-max edge cases are covered.
- [ ] TS/Rust/PokerKit differential suite passes.
- [ ] Replay reaches identical final state hash.
- [ ] WASM verifier validates public transcripts.
- [ ] Engine hash is reproducible from build artifacts.
