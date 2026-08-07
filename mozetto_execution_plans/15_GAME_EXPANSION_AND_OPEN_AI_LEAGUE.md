# 15 — Game Expansion and Open AI League

**Entry gate:** Standard NLHE Season 1 is stable and verified.  
**Exit gate:** New variants reuse the proven protocol without weakening custody, randomness, settlement, or fairness.

## Expansion rule

A new game is not primarily a new UI. It requires:

- rules specification;
- deterministic engine module;
- reference/differential tests;
- deck specification;
- randomness policy;
- settlement policy;
- rake/house-edge policy;
- controller observation/action schema;
- verification support;
- on-chain GameTemplate activation.

## Order of expansion

### 1. Pot-Limit Omaha

Why first:

- reuses poker session/custody/dealer architecture;
- same 52-card deck;
- meaningful AI strategy;
- requires pot-limit betting and four hole cards.

Work:

- PLO rules spec;
- exact use-two-hole/use-three-board hand evaluation;
- pot-limit maximum calculation;
- side-pot tests;
- controller observation update;
- PLO profile evaluation;
- new engine/rules hashes;
- new immutable GameTemplate.

### 2. Short Deck Hold'em

Work:

- 36-card deck definition;
- hand-ranking policy frozen explicitly;
- straight/flush rules;
- deck-spec hash;
- evaluator tests;
- randomness/deck batch works with 36-card canonical set;
- separate rating pool.

### 3. Ranked tournaments

Work:

- tournament coordinator;
- blind schedule;
- table balancing;
- elimination order;
- synchronized breaks;
- prize pool settlement;
- tournament root/checkpoints;
- multi-table failure recovery;
- fixed entry rather than cash-table rake model.

Do not implement tournaments as a superficial wrapper over cash sessions.

### 4. Blackjack

This is a different financial class because Mozetto is the counterparty.

Requires:

```text
HouseBankrollVault
house solvency/risk limits
maximum liability per round/table
house-edge rules
independent game template
house settlement path
separate treasury accounting
```

Do not use Poker ProtocolFeeVault as the house bankroll.

Randomness/dealer/proof infrastructure can be reused.

### 5. Additional house games

Only after HouseBankrollVault and risk engine are proven. Candidate games should have meaningful autonomous decision or clear mass-market value.

## Open AI League

Do not launch multi-model play inside Standard League.

### Separate product class

```text
Standard League
- one model policy
- equal Energy
- bounded profiles
- chess-like rating integrity

Open AI League
- approved model choices
- model committed before seal
- hidden during play if desired
- separate rating pool
- same cards/rules/rake
- model-specific Energy conversion only if formally defined
```

## ModelRegistry future

```solidity
struct ModelPolicy {
    bytes32 modelPolicyId;
    bytes32 providerId;
    bytes32 configHash;
    bytes32 promptPolicyHash;
    bytes32 outputSchemaHash;
    bytes32 energyConversionHash;
    uint64 season;
    bool active;
}
```

Season 1 Standard can hard-reference one model policy without exposing selection.

## Open-league fairness

Two valid approaches exist:

1. **Equal compute-cost envelope:** same approximate internal COGS per hand, different amounts of cognition per model.
2. **Fixed abstract Energy conversion:** published per-model operation costs based on benchmarked speed/cost/capability.

Do not improvise these values. Run large poker-specific simulations and freeze conversion by season.

The current launch decision avoids this complexity entirely.

## Model privacy

Before game:

```text
controller commitment = hash(model policy + profile + Energy policy + nonce)
```

During game:

- opponent model hidden;
- raw provider latency hidden;
- only public action cadence visible.

After game:

- reveal according to league policy;
- verify against commitment.

## 3D characters and presentation

After core protocol stability, the frontend can become more mass-market:

- stylized 3D AI avatars;
- profile-specific reactions;
- card/chip cinematics;
- league progression;
- delayed spectator commentary;
- shareable highlights.

These visuals must consume public game events and never become the source of poker truth. The AI should continue receiving structured state, not screenshots.

## Marketplace

Launch cosmetics first:

- avatars;
- card backs;
- table skins;
- entrance/victory animations.

Do not sell ranked strategy advantages, private opponent data, or extra Energy.

## Game-template release process

For every new template:

1. publish draft rules;
2. implement pure engine;
3. differential/reference test;
4. publish canonical vectors;
5. run zero-money simulation;
6. external review;
7. upload content-addressed manifest;
8. Safe/timelock register template;
9. testnet season;
10. restricted mainnet activation.

## Non-negotiable compatibility

Every new game must retain:

- ArenaAccount ownership;
- bounded permissions;
- atomic funds lock;
- participant sealing;
- verifiable randomness appropriate to game;
- canonical events;
- proof batching;
- conservation/solvency;
- public verification;
- role-separated administration.
