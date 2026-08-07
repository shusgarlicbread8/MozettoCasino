# WP-024 — ProtocolFeeVault and settlement destination constraints

**Authority:** `mozetto_execution_plans/03_BASE_CUSTODY_WALLETS_AND_PERMISSIONS.md`, `11_RAKE_UNIT_ECONOMICS_AND_TREASURY.md`  
**Specs:** frozen `specs/MOZETTO_SETTLEMENT_V3.md` (encodings untouched)  
**Prior:** WP-020–023 (vault destinations, SeatTicketV3, GameRegistry, SessionLifecycle)  
**Date:** 2026-08-07

---

## Delivered

| Item | Location |
|---|---|
| `ProtocolFeeVault` | `contracts/src/ProtocolFeeVault.sol` |
| Vault fee path | `ArenaVaultV2.withdrawProtocolFees` → `ProtocolFeeVault.depositFees` |
| Settlement destination guards | Player payouts → sealed ArenaAccounts only; fee vault / zero rejected |
| Foundry suite | `contracts/test/ProtocolFeeVault.t.sol` |
| Anvil / Sepolia deploy | `DeployLocal.s.sol`, `DeploySepolia.s.sol` |
| Manifest field | additive `protocolFeeVault` (codegen + `getManifest`) |
| This note | `docs/WP-024_PROTOCOL_FEE_VAULT.md` |

---

## Money path

```text
settleSession
  ├─ player endBalance → sealed ArenaAccount (immutable target)
  └─ rake → accruedProtocolFees (stays in ArenaVault until withdraw)

withdrawProtocolFees(amount[, periodRoot, sessionRange])
  └─ USDC + depositFees → ProtocolFeeVault (authorized depositor only)

ProtocolFeeVault.sweep(amount, periodRoot, sessionRange)
  └─ USDC → treasurySafe (Treasury Safe; owner only, not pausable by guardian alone)
```

Fee-path failure **cannot** block player settlement: rake accrues in the ArenaVault; depositing into the fee vault is a separate owner call.

---

## ProtocolFeeVault rules

| Requirement | Implementation |
|---|---|
| Only recognized protocol fees enter | `depositFees` restricted to `depositors` (ArenaVault set at deploy) |
| No player principal sweepable | Fee vault never receives settle/emergency payouts; only accrued rake |
| Sweep → Treasury Safe | `treasurySafe` immutable until timelocked update |
| Sweep event period/root/amount | `FeesSwept(treasury, amount, periodRoot, sessionRange)` |
| Treasury changes Safe + timelock | `scheduleTreasuryUpdate` / `executeTreasuryUpdate` with `minDelay` |
| Emergency pauser cannot sweep | Guardian may `pause`; `sweep` is `onlyOwner` + `whenNotPaused` |

Deposits remain allowed while paused so ArenaVault can clear `accruedProtocolFees` without waiting for unpause.

---

## Settlement destination constraints

| Destination | Allowed? |
|---|---|
| Sealed session ArenaAccount (`p.user`) | ✅ exact `startLocked`, factory account, participant, unique |
| ProtocolFeeVault (`feeTreasury` on vault) | ❌ `SettlementDestination` |
| Zero / EOA / Treasury Safe | ❌ not ArenaAccount / destination guard |
| Arbitrary backend-chosen recipient | ❌ payout address is the sealed account only |

`ArenaVaultV2.feeTreasury` retains its ABI name for compatibility; on V2 deploys it **is** the `ProtocolFeeVault` address. Manifest `feeTreasury` remains the ultimate Treasury Safe; `protocolFeeVault` is the fee accumulator.

---

## Compatibility

| Path | Status |
|---|---|
| V2 settle / openSession | Unchanged player payout semantics |
| V1 ArenaVault | Still sweeps directly to treasury EOA/Safe (legacy) |
| SettlementHubV2 EIP-712 | Untouched (Hub V3 = WP-063) |
| Frozen `/specs` | Untouched |
| poker-core / game-rules | Untouched |

---

## Follow-up

- WP-025 independent fuzz / invariant suite (liabilities + fees equality)
- WP-063 SettlementHubV3 (FullSettlementV3 encoding)
- WP-093 Protocol / Treasury Safe ownership + production timelock values
- Settlement-worker optional second hop: `ProtocolFeeVault.sweep` after `withdrawProtocolFees`
