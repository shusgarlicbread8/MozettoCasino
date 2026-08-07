# MOZETTO_GAME_TEMPLATE_V2

| Field | Value |
|---|---|
| **Version string** | `MOZETTO_GAME_TEMPLATE_V2` |
| **Status** | `frozen` |
| **Work packet** | WP-010 |
| **Domain** | `DOMAIN_GAME_TEMPLATE_V2` = `keccak256("MOZETTO_GAME_TEMPLATE_V2")` |

## 1. Normative terms

RFC 2119 **MUST** / **MUST NOT** / **SHOULD** / **MAY**.

## 2. Purpose

A game template is an immutable registry record describing rules, stakes, seat count, engine binding, and fee policy for sessions opened under that template. After registration and activation, the template body MUST NOT change.

## 3. Canonical structure

```text
GameTemplateV2
- bytes32  templateId
- uint16   protocolVersion          // 3
- bytes32  gameFamilyId             // e.g. keccak256("NLHE")
- uint8    maxSeats                 // 2 HU, 6 six-max
- uint8    minSeatsToStart
- uint256  smallBlind               // USDC base units
- uint256  bigBlind
- uint256  minBuyIn
- uint256  maxBuyIn
- bytes32  engineHash
- bytes32  rulesHash
- bytes32  randomnessPolicyId
- bytes32  settlementPolicyId
- bytes32  modelPolicyHash          // Season 1 ranked: Groq policy
- bytes32  energyPolicyHash
- bytes32  rakePolicyHash
- uint32   actionDeadlineMs         // final-action clock; Season 1 default 15000
- uint64   emergencyExitDelaySec
- bool     ranked
- bool     aiOnly
- uint32   leagueBit
```

### Template hash

```text
templateHash = keccak256(abi.encode(
  DOMAIN_GAME_TEMPLATE_V2,
  templateId,
  protocolVersion,
  gameFamilyId,
  maxSeats,
  minSeatsToStart,
  smallBlind,
  bigBlind,
  minBuyIn,
  maxBuyIn,
  engineHash,
  rulesHash,
  randomnessPolicyId,
  settlementPolicyId,
  modelPolicyHash,
  energyPolicyHash,
  rakePolicyHash,
  actionDeadlineMs,
  emergencyExitDelaySec,
  ranked,
  aiOnly,
  leagueBit
))
```

On-chain `gameTemplateId` SHOULD equal `templateId`. The registry MAY store `templateHash` for integrity checks.

## 4. Season 1 example templates

| Name | `templateId` preimage | maxSeats | Notes |
|---|---|---:|---|
| `NLHE_HU_STANDARD_V2` | `keccak256("NLHE_HU_STANDARD_V2")` | 2 | Ranked HU |
| `NLHE_SIXMAX_STANDARD_V2` | `keccak256("NLHE_SIXMAX_STANDARD_V2")` | 6 | Ranked six-max |

**Initial defaults / hypotheses (not proven optima):**

- `actionDeadlineMs = 15000`
- Rake: capped universal poker rake only (exact bps / cap in rake policy doc / Plan 11); Season 1 has **no** separate AI compute fee to players
- `smallBlind` / `bigBlind` set per stake tier at registry time

## 5. Field constraints

- `bigBlind` MUST be `2 * smallBlind` for standard NLHE Season 1 templates.
- `minBuyIn` and `maxBuyIn` MUST be multiples of `bigBlind` for Season 1.
- `maxSeats` MUST be `2` or `6` for Season 1 NLHE templates.
- `aiOnly` MUST be `true` for ranked Season 1 public tables.
- `ranked` sessions MUST set non-zero `leagueBit` per matchmaking policy.
- `modelPolicyHash` for ranked Season 1 MUST match Groq `openai/gpt-oss-120b` policy (vector 10).

## 6. Invalid examples

- Mutating `rakePolicyHash` on an active template id.
- Opening a session with `buyIn` outside `[minBuyIn, maxBuyIn]`.
- HU template with `maxSeats = 6`.
- Floating blinds.

## 7. Compatibility

- V1/V2 on-chain template ids in current Anvil manifests remain for V2 sessions.
- V3 sessions MUST reference GameTemplateV2 hashes as defined here.

## 8. Upgrade / migration

- New stakes or rule changes require a **new** `templateId`.
- Deactivation stops new sessions; historical sessions remain verifiable under the sealed template hash.
- Changing Energy or model policy requires new `energyPolicyHash` / `modelPolicyHash` and typically a new season / template.

## 9. Example values

Golden vectors 01–02 embed `TEMPLATE_HU` / `TEMPLATE_6MAX` as `keccak256(bytes("NLHE_HU_STANDARD_V2"))` and `keccak256(bytes("NLHE_SIXMAX_STANDARD_V2"))`.
