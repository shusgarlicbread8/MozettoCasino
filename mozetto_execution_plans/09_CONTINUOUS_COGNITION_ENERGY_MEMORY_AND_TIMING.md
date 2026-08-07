# 09 — Continuous Cognition, Energy, Memory, and Timing

**Entry gate:** Groq provider adapter and canonical event stream exist.  
**Exit gate:** Every seat can think throughout the hand without exceeding equal compute rules or missing final-action deadlines.

## Core concept

The 15-second action clock is not the AI's only thinking period. Each AI seat maintains a persistent private Agent Brain throughout the session. Public table events may trigger event-driven background cognition.

```text
canonical public event
        ↓
private cognitive scheduler
        ↓
ignore / deterministic update / model update
        ↓
structured AgentState
        ↓
when seat must act
        ↓
final decision call, deadline ≤ 15 seconds
```

The system is event-driven; it does not keep an API model literally running continuously.

## Agent Brain state

Store structured data, not free-form chain-of-thought:

```ts
type AgentStateV1 = {
  sessionId: string;
  handId: string;
  seat: number;
  profileHash: string;
  energyRemaining: number;
  publicEventCursor: number;
  streetPlan: StreetPlan;
  opponentModels: OpponentModel[];
  rangeHypotheses: RangeHypothesis[];
  timingModels: TimingModel[];
  tableImage: TableImage;
  recentObservations: ObservationSummary[];
  selfStrategyState: SelfStrategyState;
  memoryVersion: number;
};
```

All fields require bounded sizes and deterministic pruning rules.

## Season 1 Energy policy

### Reset

- Each seat starts every hand with exactly `100 Energy`.
- Unused Energy expires after the hand.
- No purchasing, borrowing, or cross-hand accumulation.
- All seats at a table use the same Energy policy.

### Mandatory reserve

Reserve at least `12 Energy` for the final on-turn action until the seat has folded or is all-in.

The cognitive scheduler cannot spend below the reserve during background work.

### Initial cost table

Use these as implementation defaults, then calibrate only between season versions:

| Operation | Energy |
|---|---:|
| deterministic event ingest | 0 |
| light model state update | 2 |
| opponent-model update | 4 |
| timing-pattern update | 2 |
| street strategic plan | 6 |
| memory retrieval | 3 |
| standard final decision | 8 |
| deep final decision | 16 |
| maximum final decision | 24 |

A combined request pays the highest relevant mode plus explicitly invoked memory cost; do not double-charge arbitrary internal details.

## Cognitive scheduler

The scheduler is a trusted Mozetto component, not an unrestricted LLM choice.

Inputs:

- event type;
- pot/stack geometry;
- profile parameters;
- current uncertainty;
- Energy remaining;
- whether seat is still active;
- proximity to own turn;
- provider queue health.

Outputs:

```text
IGNORE
DETERMINISTIC_UPDATE
LIGHT_UPDATE
OPPONENT_UPDATE
STREET_PLAN
DEEP_REEVALUATION
```

Each output has a fixed Energy cost and provider request configuration.

## Background cognition examples

### Trivial fold by unrelated seat

- deterministic update;
- no model call;
- `0 Energy`.

### Known aggressive opponent 3-bets

- opponent model update;
- possible range hypothesis update;
- `4 Energy`.

### Flop materially changes ranges

- street plan;
- `6 Energy`.

### Unusual 11-second action timing

- timing-pattern update;
- `2 Energy`.

## Final-action deadline

Recommended internal budget:

```text
0.0–0.4s  construct and validate observation
0.4–1.0s  select action mode and retrieve bounded memory
1.0–10.0s Groq decision request
10.0–12.0s one repair retry if allowed
12.0–15.0s cadence/fallback/commit safety window
```

The final action must be committed before the table deadline.

Background calls are cancellable/preemptible when the seat's turn begins.

## Public timing versus provider latency

Do not expose raw Groq response time as a poker tell.

Separate:

```text
providerCompletionMs — private telemetry
publicCadenceMs — strategic action timing visible at table
```

The action may be ready early but committed at a profile-selected cadence within the deadline.

Examples:

- Shark: generally quicker pressure actions;
- Professor: longer cadence on complex decisions;
- Fox: varied timing to reduce tells;
- Machine: stable cadence.

Enforce minimum and maximum bounds to avoid abusive stalling.

## Timing information available to other AIs

Other agents may observe only public timing:

- elapsed decision time;
- timeout/fallback indicator only if product policy exposes it;
- no provider name;
- no network latency;
- no exact Energy state of opponents unless intentionally public.

Do not let infrastructure behavior reveal hidden model/provider information.

## Memory tiers

### Hand memory

Full structured events for the current hand.

### Session opponent memory

Bounded statistics and observations from the current session:

- action frequencies;
- bet sizing;
- public timing;
- showdown evidence;
- profile hypotheses.

### Career public memory

Only approved public historical aggregates. Do not provide private previous hole cards that were never revealed.

## Memory retrieval

Retrieval must be typed and allowlisted:

```text
recent actions by seat
public showdown history
opponent aggregate tendencies
similar public betting lines
```

No arbitrary SQL, web search, or cross-user private data access.

## Pruning

Use deterministic pruning based on:

- recency;
- confidence;
- strategic relevance;
- fixed item/token caps.

Store summaries and source event references so the state can be audited without storing raw chain-of-thought.

## User customization

Profiles influence scheduler weights but cannot change the Energy table.

Example:

- high adaptation raises probability of opponent-model updates;
- high conservation reduces background calls;
- high tempo changes public cadence;
- high aggression changes strategic objectives, not legal actions.

Users cannot say “ignore Energy” or inject provider instructions.

## Energy ledger

Persist per hand:

```text
sessionId
handId
seat
startingEnergy
operation sequence
energy debit
remainingEnergy
provider request ID
observation hash
result hash
fallback flag
```

This ledger is private during play but may be summarized after the hand. Commit its root if it becomes part of competitive verification.

## Fairness audit

For any hand, an auditor should prove:

- every seat started at 100;
- each operation used the frozen cost table;
- no seat spent more than 100;
- final reserve rule was followed;
- model policy/profile hash matched the sealed session;
- no extra unrecorded inference call affected the action.

The last point requires all production inference traffic to flow through the audited Agent Gateway and be signed/logged.

## Degraded behavior

### Low Energy

- background cognition stops first;
- final action uses standard or minimal mode;
- deterministic fallback remains available.

### Provider congestion

- final actions get priority;
- background requests are skipped;
- Energy is not charged for requests that never execute;
- repeated degradation pauses the next hand.

### Agent-state corruption

- reconstruct from canonical public events and the last valid private state checkpoint;
- if reconstruction fails, use fallback and mark hand for review.

## Acceptance tests

- two identical seats receive identical budgets;
- scheduler never crosses reserve;
- background activity cannot block final action;
- profile changes alter scheduler behavior within bounds;
- raw provider latency is not public;
- public cadence always fits deadline;
- no private opponent data enters AgentState;
- Energy ledger totals exactly;
- replayed scheduler decisions match recorded policy version.
