# 12 — Ratings, Anti-Cheat, and Collusion

**Entry gate:** Ranked session definitions and account identity model are frozen.  
**Exit gate:** Creating agents, selecting tables, or coordinating linked accounts cannot cheaply reset/farm rating or transfer funds undetected.

## Rating owner

The user account owns the rating. Agents/profiles are loadouts.

A user may create many named agents, but they all contribute to the same account rating pool for that format.

Creating or deleting an agent never resets rating.

## Separate rating pools

```text
hu_holdem_standard_season_1
nlhe_6max_ranked_future
hu_holdem_open_ai_future
```

Do not mix:

- HU and six-max;
- Standard and Open AI;
- different game variants;
- materially different rule/compute seasons.

## HU rating

Continue using Glicko-2 behind an `Arena Rating` label.

Store:

- rating;
- rating deviation;
- volatility;
- rated matches;
- provisional status;
- last active time.

Recommended baseline:

```text
start rating: 1500
start RD: 350
provisional: first 20 matches
```

Update on complete standardized HU match/session results, not every hand.

Stake size does not multiply rating gain. A richer player cannot buy rating faster merely by risking more USDC.

## Six-max rating

Do not force HU Glicko onto arbitrary cash sessions.

Season 1 options:

- six-max cash is unrated and reports BB/100, net winnings, variance, and sample size; or
- introduce a separate fixed-format ranked six-max session later using a multiplayer Bayesian/Plackett–Luce-style rating.

Do not declare a fair six-max rating until its mathematical model and abuse resistance are specified.

## Aggression score

Aggression is descriptive, not skill. It never directly changes rating.

Calculate by format and season using opportunity-adjusted metrics:

- PFR;
- 3-bet rate;
- steal attempts;
- postflop bet/raise opportunity rate;
- raise-versus-call tendency;
- pot-relative sizing intensity;
- all-in frequency.

Normalize against same-format, position, stack-depth, and season baselines.

Use Bayesian shrinkage for small samples and recency weighting. Display confidence labels.

## Ranked matchmaking integrity

- no public ranked table selection;
- random room and seat allocation;
- temporary aliases during play;
- no self-match;
- beneficial-owner/link exclusions;
- pair-frequency caps;
- rating-band expansion only as wait time grows;
- one active rated HU match per owner initially.

## Repeated opponent policy

Example starting rule:

```text
first 5 matches in 24h: full rating weight
matches 6–10: reduced or zero weight
beyond cap: no rating effect
```

Prefer avoiding the repeated pairing entirely rather than only reducing weight.

## Identity and wallet clustering

Risk signals may include, where lawful and appropriate:

- same funding source;
- direct wallet transfers;
- repeated circular transfers;
- device/account linkage;
- network/IP linkage;
- shared withdrawal addresses;
- synchronized queue entry;
- repeated private-table history;
- abnormal mutual results.

A single weak signal should not automatically confiscate funds. Use risk scoring, seat exclusion, review, and documented escalation.

## Collusion detection

### Behavioral features

- suspicious folds in large pots;
- unusual chip dumping;
- soft play between specific pairs;
- repeated avoidance of aggression against linked seats;
- coordinated raises that isolate victims;
- abnormal showdown patterns;
- repeated net transfer direction;
- timing synchronization;
- correlated profile changes.

### Statistical process

- compare observed behavior against model/profile baselines;
- use enough sample size;
- retain explainable evidence;
- distinguish weak play from intentional transfer;
- flag but do not auto-punish solely from one model score.

## Information controls

### During ranked multiplayer play

Human owner should normally see:

- public cards/actions;
- stack/pot;
- own Agent status/Energy summary;
- no live private hole cards if collusion risk is a priority.

The AI controller sees its private cards.

Opponents and spectators never see:

- private cards;
- private reasoning;
- AgentState;
- profile/model before reveal policy;
- raw provider latency.

### Spectators

Use delayed public feeds for valuable sessions. Reveal showdown cards only according to poker rules.

## Prompt/tool cheating

Ranked Season 1 prohibits:

- arbitrary user system prompts;
- bring-your-own model/API;
- external solver;
- internet access;
- arbitrary code execution;
- live human coaching;
- mid-session profile changes.

Any coaching input is queued for a later session and compiled into bounded profile settings.

## Rating update gate

Rating updates only after:

- session settlement confirmed;
- event/replay verification passes;
- no platform-wide provider incident voids the result;
- match qualifies under pair/identity rules;
- no unresolved integrity hold.

Every rating update references `sessionId` and proof/settlement root.

## Abuse handling states

```text
CLEAR
MONITORED
MATCHMAKING_RESTRICTED
WITHDRAWAL_REVIEW where legally/operationally justified
SUSPENDED
APPEAL
RESOLVED
```

Protocol custody should not let an ordinary admin arbitrarily seize funds. Any exceptional restriction needs explicit legal/security policy and audit logs.

## Tests

- new agent does not reset rating;
- same account cannot occupy two seats;
- linked wallets excluded;
- repeated-pair cap works;
- private table result does not update ranked rating;
- stake amount does not scale rating points;
- aborted/provider-outage session does not update rating;
- aggression score shrinks to mean at low sample;
- owner cannot send a live coaching command;
- opponent cannot observe private AI state.
