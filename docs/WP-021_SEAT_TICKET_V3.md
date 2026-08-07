# WP-021 — SeatTicket V3 and atomic session funding

**Authority:** `mozetto_execution_plans/03_BASE_CUSTODY_WALLETS_AND_PERMISSIONS.md` (SeatTicket V3 + Atomic session funding)  
**Specs:** `MOZETTO_SESSION_V2`, `MOZETTO_PROTOCOL_V3` (participant / opening / controller roots)  
**Date:** 2026-08-07

---

## Delivered

| Item | Location |
|---|---|
| `SeatTicketV3` + EIP-712 `SEAT_TICKET_V3_TYPEHASH` | `contracts/src/ArenaVaultV2.sol` |
| `SessionDescriptor` (SESSION_V2 fields) + `sealAndFundSession` | same |
| Ordered Merkle root checks (participant / opening / controller / profile) | same |
| Foundry suite | `contracts/test/SeatTicketV3.t.sol` |
| TS EIP-712 types | `packages/blockchain` (`SEAT_TICKET_V3_TYPES`, `seatTicketV3Domain`) |
| Zod schemas | `packages/shared-types` (`SeatTicketV3MessageSchema`, `SessionDescriptorV2Schema`) |

V2 `SeatTicket` + `openSession` / `topUpSession` remain intact for Anvil demos and existing E2E.

---

## Plan 03 → implementation

### SeatTicketV3

Implemented exactly as Plan 03:

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

**Intentional deltas / conventions**

| Topic | Choice |
|---|---|
| Seat index | Not in Plan struct; **`tickets[i]` ⇒ seat `i`** (SESSION_V2 ascending seats) |
| `leagueBit` width | Plan `uint8`; cast to `uint32` for `ArenaAccount.lockBuyIn` |
| EIP-712 domain | Same vault domain as V2: name `MozettoArenaVault`, version `"2"` (new typehash only) |
| Signer | Session signer preferred; owner accepted (V2 parity); both via `SignatureChecker` (EOA + EIP-1271) |
| `matchmakingPool` | Maps to SESSION participant-leaf `ratingPool` |
| `profileConfigHash` | Maps to participant-leaf / profile-root `profileHash` |
| Signatures arg | Plan sketch omits them; API is `sealAndFundSession(descriptor, tickets, signatures)` |
| Emergency exit delay | Not in SessionDescriptor; vault uses `defaultEmergencyExitDelay` (owner-settable, default 7 days) |

### Atomic funding

```solidity
sealAndFundSession(SessionDescriptor descriptor, SeatTicketV3[] tickets, bytes[] signatures)
```

Reverts (no partial locks) when any participant is underfunded, expired, revoked, over caps, duplicated, wrong template/league/vault/USDC, nonce-reused, or commitment roots / sessionId mismatch.

Root verification uses Protocol V3 **positional** ordered Merkle (pad to power-of-2 with `bytes32(0)`), not the sorted-pair hasher used by legacy emergency-exit proofs.

---

## V2 migration

| Path | Status |
|---|---|
| `openSession` + V2 `SeatTicket` | **Supported** — demos / current matchmaking |
| `sealAndFundSession` + V3 | **Canonical** for ranked sealed tables going forward |
| Shared nonces | `usedNonces[arenaAccount][nonce]` shared across V2 and V3 |
| Settlement | Unchanged `settleSession` / Hub V2 |

Services should migrate ticket minting to `SEAT_TICKET_V3_TYPES` when sealing ranked sessions. Do not mix V2 ticket fields into V3 roots.

---

## Deferred (not WP-021)

- GameRegistryV2 / template-set root (`allowedTemplateSetRoot`) — WP-022 **partial**: registry DONE; set-root on GamePermission still deferred
- Full DRAFT→SETTLED lifecycle machine — WP-023
- ProtocolFeeVault — WP-024  
- Independent fuzz/invariant suite — WP-025  
- Continuous cash-table epoch joins — Plan 03 later section  

---

## Evidence

```bash
cd contracts && forge test --match-contract SeatTicketV3Test
cd contracts && forge test --match-contract ArenaAccountV2Test
```
