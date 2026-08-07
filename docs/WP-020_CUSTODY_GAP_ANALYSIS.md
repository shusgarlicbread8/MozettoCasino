# WP-020 — ArenaAccount / GamePermission gap analysis

**Authority:** `mozetto_execution_plans/03_BASE_CUSTODY_WALLETS_AND_PERMISSIONS.md`  
**Scope:** Audit V2 `ArenaAccount` + `GamePermission` + `ArenaVaultV2` settlement destination constraints against Plan 03.  
**Constraint:** Prefer compatibility additions; do **not** introduce ArenaVaultV3 / SettlementHubV3 / RandomnessBeaconV2; do **not** silently change frozen `/specs` encodings.

**Date:** 2026-08-07

---

## Summary

V2 already implements the core Plan 03 custody model: owner-held idle USDC, owner-signed GamePermission, vault-only `lockBuyIn` under caps, atomic multi-seat open, and settlement payouts to sealed ArenaAccounts with rake accrued separately.

WP-020 adds owner-only revoke / emergency invalidate, two-step ownership transfer synced through the factory, stricter settlement destination / exact-lock checks, expanded Foundry coverage, and stronger mainnet MockUSDC rejection in the chain manifest.

Remaining Plan 03 items that require new EIP-712 shapes or dedicated contracts are deferred to WP-021+ / WP-024 / WP-025.

---

## Plan 03 → V2 mapping

### Owner powers

| Requirement | V2 before WP-020 | After WP-020 | Notes |
|---|---|---|---|
| Withdraw idle USDC | ✅ `withdraw` owner-only | ✅ | Locked funds already transferred to vault |
| Revoke GamePermission | ✅ EIP-712 `enabled=false` | ✅ + `revokeGamePermission()` | Owner can revoke without a signature |
| Change ownership (secure path) | ❌ immutable after init | ✅ two-step + factory `syncOwner` | |
| Authorize session signer | ✅ via `setGamePermission` | ✅ | Unchanged EIP-712 typehash |
| Emergency nonce bump | ⚠️ only via signed set | ✅ `emergencyInvalidatePermissions` / owner revoke bumps nonce | |

### Mozetto / vault powers

| Requirement | Status | Notes |
|---|---|---|
| Lock buy-in under active permission | ✅ | |
| Lock only to approved vault | ✅ `msg.sender == auth.vault` | |
| Approved template / league | ✅ single `gameTemplateId` + `leagueMask` | Template **set root** deferred |
| Caps: single, at-risk, concurrent, lifetime, expiry | ✅ | `validAfter` not in V2 typehash — deferred |
| May not transfer to arbitrary / call arbitrary / withdraw | ✅ | No `execute` / no platform withdraw |
| May not modify limits / extend expiry / change owner | ✅ | Requires owner EIP-712 or owner `msg.sender` |
| May not use after revocation | ✅ | |

### GamePermission fields (Plan `GamePermissionV2`)

| Plan field | V2 field | Status |
|---|---|---|
| `account` | bound in EIP-712 as `address(this)` | ✅ |
| `sessionSigner` | `sessionSigner` | ✅ |
| `usdc` / `vault` | ✅ | |
| `allowedTemplateSetRoot` | single `gameTemplateId` | 🟡 Gap — set-root needs typehash change (WP-021/V3) |
| `allowedLeagueMask` | `leagueMask` (`uint32`) | ✅ |
| `lifetimeCommittedCap` | ✅ + `lifetimeCommitted` accounting | ✅ |
| `maxTotalAtRisk` | ✅ + `activeAtRisk` | ✅ |
| `maxSingleBuyIn` | ✅ | |
| `maxConcurrentGames` | ✅ + `activeGames` | ✅ |
| `validAfter` | — | 🟡 Gap — adding would break V2 EIP-712 clients |
| `expiresAt` | `validUntil` | ✅ naming only |
| `nonce` | `gameAuthNonce` | ✅ |
| `ratedOnly` | ✅ (V2 extra) | Compatible |

### Permission accounting

| Track | Status |
|---|---|
| Lifetime committed | ✅ preserved across revoke/re-auth |
| Active risk | ✅ |
| Active game count | ✅ |
| Consumed permission nonce | ✅ |
| Revoked state | ✅ `enabled=false` |
| Settlement does not refill lifetime | ✅ | Settlement only `releaseExposure` |

### Settlement destination restrictions

| Requirement | Status |
|---|---|
| Player payout → sealed ArenaAccount only | ✅ `settleSession` transfers to `p.user` after participant + factory checks |
| No arbitrary recipient in payload | ✅ hardened: reject zero / feeTreasury / non-account; exact `startLocked` |
| Non-player destination = ProtocolFeeVault | 🟡 rake accrues in vault; dedicated ProtocolFeeVault → **WP-024** |

### Network asset policy

| Requirement | Status |
|---|---|
| Anvil MockUSDC | ✅ |
| Base Sepolia labelled USDC | ✅ manifest |
| Base Mainnet Circle USDC only | ✅ codegen + `getManifest` rejects test flags / non-Circle env override |

### Out of WP-020 scope (explicit)

| Item | Packet |
|---|---|
| SeatTicket V3 + `sealAndFundSession` rename/shape | WP-021 |
| GameRegistryV2 / template set root | WP-022 registry DONE; set-root still deferred |
| Session lifecycle DRAFT→SETTLED | WP-023 |
| ProtocolFeeVault + treasury timelock | WP-024 |
| Independent fuzz / invariant suite | WP-025 |
| Chain indexer + reconciliation pause | Plan 03 / later infra |

---

## Compatibility decisions

1. **Do not change** `GAME_PERMISSION_TYPEHASH` or `SEAT_TICKET_TYPEHASH` — Anvil E2E and web/API signers depend on them.
2. **Do not reorder** `GameAuth` storage layout — API reads positional `gameAuth()` tuple indices.
3. Owner-only revoke / ownership transfer / settlement guards are **additive**.

---

## Evidence (acceptance)

- Gap analysis: this document
- Contract changes: `ArenaAccount.sol`, `ArenaAccountFactory.sol`, `ArenaVaultV2.sol`
- Tests: `contracts/test/ArenaAccountV2.t.sol` (caps, revoke, expiry, wrong signer, settlement destinations, ownership)
- Manifest: `packages/chain-manifest/src/index.ts` + `mainnet-guard.test.ts`
- Commands: `forge test --match-contract ArenaAccountV2Test`, chain-manifest mainnet guard tests
