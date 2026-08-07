# MOZETTO_SESSION_V2

| Field | Value |
|---|---|
| **Version string** | `MOZETTO_SESSION_V2` |
| **Status** | `frozen` |
| **Work packet** | WP-010 |
| **Domain** | `DOMAIN_SESSION_V2` = `keccak256("MOZETTO_SESSION_V2")` |

## 1. Normative terms

RFC 2119 **MUST** / **MUST NOT** / **SHOULD** / **MAY**.

## 2. Purpose

`SessionDescriptorV2` is the sealed commitment of who plays, with which controllers/profiles, under which template and randomness/settlement policies. After seal, participant identity, buy-ins, controllers, and profiles MUST NOT change without opening a new epoch/session per lifecycle rules.

## 3. Lifecycle states (normative names)

```text
DRAFT → SEALED → RANDOMNESS_PENDING → READY → ACTIVE → SETTLING → SETTLED
                         ↘ ABORTED / EMERGENCY_EXIT
```

Sealing binds `SessionDescriptorV2`. Randomness binding MUST NOT precede seal. Participant mutation after seal MUST be impossible for that epoch.

## 4. Participant leaf

```text
participantLeaf = keccak256(abi.encode(
  DOMAIN_PARTICIPANT_LEAF_V1,
  address owner,              // EOA / owner wallet
  address arenaAccount,       // ArenaAccount custody address
  uint8   seat,
  uint256 buyIn,              // USDC base units
  bytes32 controllerHash,
  bytes32 profileHash,
  bytes32 ratingPool,
  bool    rated,
  uint256 seatTicketNonce
))
```

Leaves are ordered by ascending `seat`. `participantRoot` is the ordered Merkle root (Protocol V3 Merkle rules).

## 5. Opening balance leaf

```text
openingBalanceLeaf = keccak256(abi.encode(
  DOMAIN_OPENING_BALANCE_LEAF_V1,
  bytes32 sessionId,
  address arenaAccount,
  uint8   seat,
  uint256 openingBalance
))
```

For Season 1 cash sessions, `openingBalance` MUST equal the locked `buyIn` at seal.

## 6. Controller leaf

```text
controllerLeaf = keccak256(abi.encode(
  DOMAIN_CONTROLLER_LEAF_V1,
  uint8   seat,
  bytes32 controllerHash
))
```

## 7. Session id derivation

```text
sessionId = keccak256(abi.encode(
  DOMAIN_SESSION_ID_V1,
  uint256 chainId,
  bytes32 gameTemplateId,
  bytes32 participantRoot,
  bytes32 sessionNonce,
  uint64  createdAt
))
```

## 8. SessionDescriptorV2

Field order (exact):

| # | Field | Type |
|---|---|---|
| 1 | `chainId` | `uint256` |
| 2 | `protocolVersion` | `uint16` (=3) |
| 3 | `sessionId` | `bytes32` |
| 4 | `gameTemplateId` | `bytes32` |
| 5 | `participantRoot` | `bytes32` |
| 6 | `openingBalanceRoot` | `bytes32` |
| 7 | `controllerRoot` | `bytes32` |
| 8 | `profileRoot` | `bytes32` |
| 9 | `dealerSecretRoot` | `bytes32` |
| 10 | `randomnessPolicyId` | `bytes32` |
| 11 | `settlementPolicyId` | `bytes32` |
| 12 | `createdAt` | `uint64` |
| 13 | `sealDeadline` | `uint64` |
| 14 | `sessionNonce` | `bytes32` |

```text
sessionDescriptorHash = keccak256(abi.encode(
  DOMAIN_SESSION_V2,
  chainId,
  protocolVersion,
  sessionId,
  gameTemplateId,
  participantRoot,
  openingBalanceRoot,
  controllerRoot,
  profileRoot,
  dealerSecretRoot,
  randomnessPolicyId,
  settlementPolicyId,
  createdAt,
  sealDeadline,
  sessionNonce
))
```

`profileRoot` is the ordered Merkle root of per-seat `profileHash` values (seat order).

At DRAFT→SEALED, `dealerSecretRoot` MUST already be the committed dealer secret batch root for the first randomness epoch (or a well-defined placeholder only if the randomness policy explicitly allows post-seal commit **before** VRF — Season 1 MUST commit secrets before VRF; see Randomness V2).

## 9. Hand id

```text
handId = keccak256(abi.encode(
  DOMAIN_HAND_ID_V1,
  bytes32 sessionId,
  uint64  epoch,
  uint64  handNumber
))
```

`handNumber` is 1-indexed within an epoch. Skipped/aborted hand indices remain consumed (Randomness V2).

## 10. Example values

Golden vectors:

- `01_session_hu.json`
- `02_session_sixmax.json`

Anvil `chainId = 31337`. Buy-in examples use integer base units (`100_000_000` = 100 USDC).

## 11. Invalid examples

- Changing a participant leaf after seal while reusing `sessionId`.
- Encoding absent seats as `seat=255`.
- Hashing the human JSON projection.
- `protocolVersion = 2` under DOMAIN_SESSION_V2 for a V3 session.
- Six-max descriptor with only 5 leaves when 6 seats are seated.

## 12. Compatibility

- V2 `SessionConfig` in ArenaVaultV2 is a different encoding; V3 verifiers MUST NOT mix them.
- SeatTicket V3 (future WP-021) MUST populate the participant leaf fields consistently with this spec.

## 13. Upgrade / migration

- New session descriptor fields require `MOZETTO_SESSION_V3` (or higher) and new domain string.
- Epoch rotation for joins/leaves creates a new participant root and randomness epoch; it MUST NOT rewrite historical sealed descriptors.
