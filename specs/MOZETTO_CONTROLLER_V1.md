# MOZETTO_CONTROLLER_V1

| Field | Value |
|---|---|
| **Version string** | `MOZETTO_CONTROLLER_V1` |
| **Status** | `frozen` |
| **Work packet** | WP-014 |
| **Domains** | `PROFILE_V1`, `MODEL_POLICY_V1`, `CONTROLLER_REQUEST_V1`, `CONTROLLER_RESPONSE_V1` |

## 1. Normative terms

RFC 2119 **MUST** / **MUST NOT** / **SHOULD** / **MAY**.

## 2. Purpose

The poker core asks a **controller** for an action. The core MUST NOT know whether the controller is AI, human test input, replay, or fallback. The engine MUST ignore any field outside the schemas defined here.

## 3. Strategy profile (ProfileConfigV1)

Axes are `uint8` in `0..100`:

```text
aggression, riskTolerance, deception, opponentAdaptation,
trapPreference, tempo, variancePreference, energyConservation
```

Full hash preimage:

```text
profileConfigHash = keccak256(abi.encode(
  DOMAIN_PROFILE_V1,
  bytes32 profileId,
  uint16  profileVersion,
  bytes32 presetId,
  uint8   aggression,
  uint8   riskTolerance,
  uint8   deception,
  uint8   opponentAdaptation,
  uint8   trapPreference,
  uint8   tempo,
  uint8   variancePreference,
  uint8   energyConservation,
  uint32  allowedSchedulerWeights,
  uint64  createdAt,
  uint32  ownerCustomizationVersion
))
```

Ranked Season 1 MUST NOT include arbitrary free-text prompts in the hash preimage.

### Presets (ids)

| Preset | `presetId` preimage |
|---|---|
| Shark | `keccak256("PRESET_SHARK")` |
| Fox | `keccak256("PRESET_FOX")` |
| Professor | `keccak256("PRESET_PROFESSOR")` |
| Machine | `keccak256("PRESET_MACHINE")` |

Profiles influence scheduler weights and strategic objectives. They MUST NOT change the Energy cost table or legal action set.

## 4. Model policy (Season 1 Groq)

```text
modelPolicyHash = keccak256(abi.encode(
  DOMAIN_MODEL_POLICY_V1,
  bytes32 policyId,
  uint16  policyVersion,
  bytes32 providerId,                 // keccak256("groq")
  bytes32 modelId,                    // keccak256("openai/gpt-oss-120b")
  bytes32 reasoningEffortPolicy,
  bytes32 outputMode,                 // strict JSON schema
  uint32  maxOutputTokens,
  uint32  temperatureMilli,
  bytes32 masterPolicyHash,
  bytes32 profileSetHash,
  bytes32 energyPolicyHash,
  bytes32 contextTruncationPolicy,
  bytes32 fallbackPolicyHash,
  bool    toolsDisabled               // MUST be true Season 1
))
```

**Initial defaults / hypotheses** (recalibrate only via new policy version):

- `maxOutputTokens = 256`
- `temperatureMilli = 0`
- provider/model fixed as above for ranked Season 1
- no web search, browser, code execution, solvers, or opponent chat tools

If Groq serving behavior changes materially, operators MUST launch a new engine season — not silently continue rated play.

Golden vector: `10_model_policy_groq.json`.

## 5. ControllerRequestV1

```text
ControllerRequestV1
- bytes32 observationHash
- bytes32 publicStateHash
- bytes32 legalActionsHash
- uint16  energyRemaining
- uint64  actionDeadlineElapsedMs
- uint16  controllerPolicyVersion
- bytes32 profileHash
- bytes32 modelPolicyHash
- uint8   seat
- bytes32 handId
- bytes32 sessionId
```

```text
requestHash = keccak256(abi.encode(
  DOMAIN_CONTROLLER_REQUEST_V1,
  observationHash,
  publicStateHash,
  legalActionsHash,
  energyRemaining,
  actionDeadlineElapsedMs,
  controllerPolicyVersion,
  profileHash,
  modelPolicyHash,
  seat,
  handId,
  sessionId
))
```

Private observation (hole cards, AgentState) MUST NOT be placed in public logs. `observationHash` commits to the private bundle via a separate authenticated channel.

### Observation security

The model/controller MAY receive: own hole cards, public board, public history, positions/stacks/pot, legal actions, private AgentState, public timing features, Energy remaining.

MUST NOT receive: full deck, opponent holes, opponent profiles/policies, opponent private memory, raw user identity, admin secrets.

## 6. ControllerResponseV1

```text
ControllerResponseV1
- uint16  actionType          // same codes as PokerEvent action types 10–15
- uint256 amount              // chips-added; 0 if N/A
- uint32  publicCadenceMs     // strategic commit delay; NOT raw provider latency
- uint16  reasonCode          // bounded enum
- bytes32 responseNonce
- bool    fallbackUsed
```

```text
responseHash = keccak256(abi.encode(
  DOMAIN_CONTROLLER_RESPONSE_V1,
  actionType,
  amount,
  publicCadenceMs,
  reasonCode,
  responseNonce,
  fallbackUsed
))
```

Only `actionType` and legal `amount` affect poker. `reasonCode` is analytics-only.

`publicCadenceMs` MUST fit within the remaining action deadline. Raw provider completion time MUST NOT be exposed as a public tell.

## 7. AgentStateV1 (structured; not free-form CoT)

Normative fields (bounded sizes; deterministic pruning):

```text
sessionId, handId, seat, profileHash, energyRemaining, publicEventCursor,
streetPlan, opponentModels[], rangeHypotheses[], timingModels[],
tableImage, recentObservations[], selfStrategyState, memoryVersion
```

Store structured summaries + event references. MUST NOT store raw chain-of-thought as consensus state.

## 8. Fallback

On provider failure: primary → one schema-repair retry if time permits → deterministic fallback → record failure.

Repair MUST NOT grant a second strategic choice after seeing illegality of a preferred action beyond constrained representation fix.

Fallback MUST be deterministic, legal, and marked `fallbackUsed=true`.

## 9. Example values

Vectors `09_profile_hash.json`, `10_model_policy_groq.json`.

## 10. Invalid examples

- Free-text ranked prompts inside profile hash.
- `toolsDisabled=false` for Season 1 ranked.
- Axis value `101`.
- Engine accepting response fields outside schema.
- Exposing provider latency as `publicCadenceMs` without bounds.

## 11. Compatibility / upgrade

- New axes or policy fields require version bump and new domain usage rules.
- Active seasons MUST NOT silently mutate model policy or profile envelopes.
