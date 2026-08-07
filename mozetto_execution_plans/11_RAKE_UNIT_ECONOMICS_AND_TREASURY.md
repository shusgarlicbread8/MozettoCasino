# 11 — Rake, Unit Economics, and Treasury

**Entry gate:** Game-template and settlement conservation rules exist.  
**Exit gate:** Every hand and session has transparent, capped fees and measurable positive/negative contribution without hidden player charges.

## Launch economic decision

Season 1 charges one user-visible fee:

> **Poker rake**

There is no:

- model-specific fee;
- AI performance fee;
- separate token charge;
- compute invoice;
- provider surcharge.

Mozetto pays AI inference, relayer gas, VRF, proof anchoring, dealer, database, and infrastructure from rake revenue.

## Rake formula

```text
rake = min(eligiblePot × rakeBps / 10,000, rakeCap)
```

All arithmetic uses integer USDC units and a documented rounding direction.

## Eligibility

Recommended Season 1 policy:

- `noFlopNoDrop = true` for cash poker;
- no rake if the hand ends before the flop;
- no rake from returned uncalled bets;
- rake deducted only from settled eligible pots;
- total hand rake cannot exceed cap;
- side-pot allocation of rake follows one frozen method.

The engine must emit exact rake events; settlement does not invent rake afterward.

## Provisional schedule

These are starting hypotheses for simulation, not automatic mainnet values:

| League | Rake | Cap |
|---|---:|---:|
| Bronze | 3.0% | 2 BB |
| Silver | 2.75% | 2 BB |
| Gold | 2.5% | 1.5 BB |
| Platinum | 2.25% | 1.25 BB |
| Diamond+ | 2.0% | 1 BB |

Freeze the final schedule in each GameTemplate after unit-economic and market testing. Higher stakes should generally have lower effective percentage caps.

## Why the cap matters

Infrastructure cost does not rise linearly with a huge pot. Uncapped percentage rake can make high-stakes liquidity economically irrational and damage trust.

## Conservation

Per hand:

```text
sum(stacks before hand) == sum(stacks after hand) + handRake
```

Per session:

```text
sum(starting locked balances) == sum(final player payouts) + totalRake
```

No AI fee appears in Season 1 conservation.

## Internal cost accounting

Track, per hand/session/table/league:

### AI

- input tokens;
- output/reasoning tokens where reported;
- request count;
- background vs final calls;
- retries;
- provider cost;
- fallback rate.

### Chain

- session open/lock gas;
- VRF cost amortization;
- proof-batch anchor gas;
- checkpoint gas;
- settlement gas;
- relayer overhead.

### Infrastructure

- game compute;
- dealer/enclave;
- database;
- Redis;
- WebSocket egress;
- storage/proof packages;
- monitoring/security.

### Contribution

```text
rake revenue
- AI COGS
- chain COGS
- infrastructure COGS
= gross protocol contribution
```

Do not make user fee decisions from guesses. Instrument the system from Anvil simulations through Sepolia.

## 100 Energy cost guard

The Energy policy bounds AI cost. Internally define target cost bands per seat/hand. If cost exceeds targets:

- optimize context;
- increase deterministic updates;
- adjust cognitive-mode provider parameters in the next season;
- improve caching/summarization;
- do not silently reduce a seat's Energy during an active season.

## Context optimization

- send structured deltas, not full transcript every call;
- maintain server-side AgentState;
- cache static master policy/profile data if provider supports it;
- bound memory retrieval;
- keep action output extremely small;
- avoid multimodal screenshots for ranked decisions.

## Treasury architecture

### ProtocolFeeVault

Accrues only rake.

### Treasury Safe

Receives periodic fee sweeps.

### Relayer operating wallet

Holds limited ETH for gas; no player USDC authority.

### VRF funding account

Separate operational funding and monitoring.

### HouseBankrollVault

Does not exist until house games launch. Never mix it with poker funds or poker rake accounting.

## Fee sweep

- sweep only accepted accrued fees;
- include source period/root/session range;
- emit transparent event;
- destination is timelocked Treasury Safe;
- set operational thresholds to avoid unnecessary gas;
- fee sweep failure cannot block player settlement.

## Revenue reporting

Admin and public transparency should distinguish:

```text
gross rake
net rake after refunds/reversals
AI COGS
chain COGS
protocol contribution
Treasury sweep
```

Do not mislabel total locked player funds as platform volume/revenue.

## Refund/abort policies

Before ACTIVE:

- full buy-in unlock;
- no rake;
- Mozetto absorbs incurred setup cost.

During ACTIVE catastrophic abort:

- use last valid checkpoint or documented recovery;
- no rake for unresolved hand unless rules explicitly allow completed prior hands;
- publish incident proof package.

## High-stakes gate

Before enabling very large buy-ins:

- measured p99 settlement latency;
- independent attestors;
- frequent checkpoints;
- dedicated/private inference decision;
- stronger dealer assurance;
- treasury and insurance/risk plan;
- explicit max protocol exposure.

## Unit-economic acceptance

Before mainnet, produce a report for each proposed league:

- average hands/hour;
- average eligible pot;
- effective rake rate;
- AI cost/hand;
- chain cost/hand;
- infrastructure cost/hand;
- contribution margin;
- worst-case provider-cost spike;
- break-even concurrency;
- high-stakes cap rationale.

The final fee schedule requires Protocol Safe/timelock activation and public manifest publication.
