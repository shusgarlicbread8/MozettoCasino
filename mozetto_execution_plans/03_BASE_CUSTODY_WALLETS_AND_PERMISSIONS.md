# 03 — Base Custody, Wallets, and Permissions

**Entry gate:** Canonical protocol vectors are frozen.  
**Exit gate:** No tested sequence can make Vault liabilities diverge from held USDC or redirect a player's payout.

## Target custody model

```text
Owner wallet / passkey
        │ owns
        ▼
ArenaAccount
  - holds idle gaming USDC
  - owner-only withdrawal
  - bounded GamePermission
        │ session lock
        ▼
ArenaVaultV3-compatible custody
  - session-scoped buy-in locks
  - settlement only through approved verifier path
  - rake accrual only
        │
        ├── player payout → ArenaAccount
        └── protocol fees → ProtocolFeeVault → Treasury Safe
```

Keep the current ArenaAccount V2 architecture unless formal review finds a critical defect. Prefer compatibility additions over unnecessary replacement.

## Network asset policy

| Environment | Chain | Asset |
|---|---|---|
| Local | Anvil `31337` | six-decimal MockUSDC |
| Staging | Base Sepolia `84532` | test USDC or clearly labelled mUSDC |
| Production | Base Mainnet `8453` | native Circle USDC only |

The chain manifest must reject MockUSDC on Base Mainnet.

## ArenaAccount requirements

### Owner powers

Only the owner may:

- withdraw idle USDC;
- revoke a GamePermission;
- change ownership through an explicit secure path;
- authorize a new session signer;
- invalidate all permissions through an emergency nonce bump.

### Mozetto powers

Mozetto may only:

- lock a buy-in that satisfies an active GamePermission;
- lock to the approved ArenaVault;
- lock for an approved template/league;
- stay within single-buy-in, total-at-risk, concurrent-game, lifetime, and expiry caps.

Mozetto may not:

- transfer USDC to an arbitrary address;
- call arbitrary contracts through the account;
- withdraw to itself;
- modify permission limits;
- extend permission expiry;
- change the owner;
- use a permission after revocation.

## GamePermission V2 design

Include at minimum:

```solidity
struct GamePermissionV2 {
    address account;
    address sessionSigner;
    address usdc;
    address vault;
    bytes32 allowedTemplateSetRoot;
    uint256 allowedLeagueMask;
    uint256 lifetimeCommittedCap;
    uint256 maxTotalAtRisk;
    uint256 maxSingleBuyIn;
    uint32 maxConcurrentGames;
    uint64 validAfter;
    uint64 expiresAt;
    uint256 nonce;
}
```

Prefer a set root or registry policy over one fixed template if the user explicitly allows several ranked game templates.

### Permission accounting

Track separately:

- lifetime amount committed;
- currently active risk;
- active game count;
- consumed nonce/permission hash;
- revoked state.

Settlement does not silently refill a lifetime cap. If product requirements need renewable periods, define explicit period-based allowances rather than ambiguous refilling.

## SeatTicket V3

SeatTickets are signed by the authorized session signer, not the owner, after GamePermission is active.

```solidity
struct SeatTicketV3 {
    address arenaAccount;
    bytes32 gameTemplateId;
    bytes32 matchmakingPool;
    uint256 buyIn;
    bytes32 controllerHash;
    bytes32 profileConfigHash;
    bytes32 modelPolicyHash;
    uint8 leagueBit;
    bool rated;
    uint64 expiresAt;
    uint256 nonce;
}
```

The Vault validates both:

1. the SeatTicket signature; and
2. the account's active GamePermission constraints.

Support EOA signatures and EIP-1271 smart-account validation.

## Atomic session funding

For a sealed ranked match, use one relayed transaction that locks every participant atomically:

```solidity
sealAndFundSession(SessionDescriptor descriptor, SeatTicketV3[] tickets)
```

The transaction reverts if any participant is:

- underfunded;
- expired;
- revoked;
- above permission caps;
- duplicated;
- in an unauthorized template or league;
- using a reused nonce;
- mismatched with the participant root.

Do not begin randomness or play on an off-chain promise of funds.

## Continuous cash-table epochs

If a table supports joins between hands:

- the new user's ticket may be collected during the current hand;
- funds may be reserved/locked;
- the user becomes active only in the next sealed epoch;
- the current hand's participant root remains unchanged;
- a new participant root and opening-balance root are committed for the next epoch.

## Vault accounting

Track:

```text
session opening balance by ArenaAccount
current locked amount by session
accepted checkpoint sequence
settlement status
accrued protocol rake
```

Core invariant:

```text
USDC.balanceOf(vault)
== total session liabilities + accrued protocol fees
```

If the Vault holds any unrelated operational funds, move them out. The equality should remain simple.

## Settlement destination restrictions

For each participant, the only permitted payout destination is the ArenaAccount recorded at session seal.

The only non-player destination is the registered ProtocolFeeVault.

The settlement payload must not contain arbitrary recipient addresses selected by the backend.

## ProtocolFeeVault

Create a minimal fee accumulator or retain Vault fee accrual with a controlled sweep.

Requirements:

- only recognized protocol fees enter;
- no player principal is sweepable;
- sweep destination is a configured Treasury Safe;
- sweep event includes period/root/amount;
- treasury changes require Safe + timelock;
- emergency pauser cannot sweep.

## Chain indexer

The indexer is the sole writer of on-chain money mirrors in Postgres.

It must:

- start from deployment block;
- store `(chainId, blockNumber, txHash, logIndex)`;
- process idempotently;
- detect removed/reorged logs;
- backfill from zero;
- derive deposits, locks, settlements, fees, and withdrawals;
- never trust a client-supplied amount or transaction status;
- expose lag and reconciliation metrics.

## Reconciliation

At a fixed interval and after every settlement batch, compare:

1. USDC token balance held by Vault;
2. Vault internal liabilities and fees;
3. indexer-derived mirror;
4. Postgres session projections.

Any unexplained difference:

- pauses new sessions automatically;
- raises a critical incident;
- does not allow an admin to patch balances manually.

## Contract roles

| Role | Capability |
|---|---|
| Protocol Safe | upgrades/registry/verifier changes through timelock |
| Emergency Guardian | pause new sessions and selected operations only |
| Session Relayer | pay gas for permitted session actions |
| Settlement Submitter | submit already verified settlements |
| Verifier/Attestors | sign state, never move funds directly |
| Treasury Safe | receive protocol revenue |
| User Owner | withdraw and revoke permissions |

No single private key should possess every role.

## Security tests

### Unit/fuzz

- permission expiry and revocation;
- max single buy-in;
- max active risk;
- max concurrent games;
- lifetime cap;
- nonce replay;
- signature malleability;
- EIP-1271 validation;
- underfunded atomic table;
- duplicate participant;
- wrong template/league;
- wrong vault/token;
- settlement overpayment;
- arbitrary recipient attempt;
- double settlement;
- fee above cap;
- withdrawal of locked funds;
- reentrancy and token callback behavior.

### Invariants

- liabilities never exceed token balance;
- settlement cannot create value;
- protocol fee cannot include user principal;
- user cannot lose more than locked amount;
- paused state cannot block legitimate emergency exit unless explicitly required by a separate catastrophe mode;
- no backend role can withdraw from ArenaAccount.

## Exit evidence

- Foundry invariant suite passes at high run counts.
- Indexer rebuild derives exactly the same balances.
- A compromised session signer is constrained to the user's permission caps and approved game targets.
- A compromised settlement submitter cannot redirect a payout.
- A treasury signer cannot alter a game result.
