# 08 — Groq GPT-OSS 120B AI Runtime

**Season 1 decision:** Use Groq model ID `openai/gpt-oss-120b` as the only ranked underlying model.  
**Entry gate:** Controller and profile schemas are frozen.  
**Exit gate:** AI-only tables complete at target reliability, latency, and policy separation.

## Why this model

The launch thesis is to test extremely fast, repeated cognition rather than one slow, maximal reasoning call. Groq currently documents GPT-OSS 120B as a production model with reasoning, tool/JSON capabilities, a large context window, and roughly hundreds of tokens per second. The implementation must rely on measured Mozetto poker performance—not marketing claims—before real-money activation.

## Product rule

The player does not select a model in Season 1.

Every ranked seat gets:

```text
same model
same exact model policy
same observation schema
same tools/action schema
same memory limits
same 100 Energy
same final-action deadline
same fallback behavior
```

The user selects a bounded strategy profile.

## Provider abstraction

Keep a general interface even though only Groq is enabled:

```ts
interface PokerModelProvider {
  updateState(input: BackgroundCognitionRequest): Promise<BackgroundCognitionResult>;
  decide(input: DecisionRequest): Promise<DecisionResult>;
  health(): Promise<ModelHealth>;
}
```

Implement:

```text
GroqGptOss120BProvider
DeterministicFallbackController
ReplayController
MockController
```

Do not implement or expose OpenAI/Anthropic/DeepSeek selection in the Season 1 UI.

## Pinned model policy

Create `MOZETTO_AI_ENGINE_SEASON_1`:

```text
provider: groq
model: openai/gpt-oss-120b
reasoning effort policy: frozen by cognitive mode
output mode: strict JSON schema
max output: small, bounded
temperature/sampling: frozen
master policy hash: frozen
profile set hash: frozen
energy policy hash: frozen
context truncation policy: frozen
fallback policy: frozen
```

If Groq changes the actual serving behavior materially, launch a new engine season rather than silently continuing rated play.

## No built-in external tools

The model must not use:

- web search;
- browser tools;
- code execution;
- arbitrary remote tools;
- user-provided APIs;
- external poker solvers;
- chat input from opponents.

The only effective action surface is the typed poker action response. The game server—not the model—executes it.

## Master poker policy

Use one versioned system specification that defines:

- role as autonomous poker controller;
- observation semantics;
- private/public information boundaries;
- legal action format;
- energy behavior;
- memory update format;
- no disclosure of internal reasoning;
- no attempts to access unavailable information;
- exact response schemas;
- behavior on uncertainty.

Profiles are data injected separately, not separate unrelated prompts.

## Strategy profiles

Initial presets:

### Shark

- high pressure;
- high aggression;
- higher variance tolerance;
- faster public cadence;
- willing to spend Energy searching for pressure spots.

### Fox

- high opponent adaptation;
- deceptive timing and line variation;
- heavier opponent-model updates;
- moderate risk.

### Professor

- patient and selective;
- conserves Energy;
- spends deeply on large turn/river decisions;
- lower variance.

### Machine

- balanced baseline;
- consistent cadence;
- disciplined Energy use;
- low stylistic deviation.

Optional `Blitz` should be introduced only if profile-separation tests show it adds distinct behavior rather than cosmetic speed.

## Bounded customization

Allow integer sliders such as:

```text
aggression           0..100
riskTolerance        0..100
deception            0..100
opponentAdaptation   0..100
trapPreference       0..100
tempo                 0..100
energyConservation   0..100
variancePreference   0..100
```

The server validates values and allowed profile envelope. No ranked free-text prompt in Season 1.

## Observation security

The model receives only:

- own hole cards;
- public board;
- public action history;
- positions/stacks/pot;
- legal actions;
- private structured AgentState;
- public timing features;
- Energy remaining.

It never receives:

- full deck;
- opponent hole cards;
- opponent profile/model policy;
- opponent private memory;
- raw user identity data;
- admin/system secrets.

Replace usernames and chat with neutral seat IDs in model context.

## Decision schema

Example:

```json
{
  "action": "raise",
  "amount": "640000000",
  "publicCadenceMs": 4200,
  "reasonCode": "PRESSURE_VALUE_MERGE",
  "statePatchId": "..."
}
```

Only `action` and legal amount affect poker. `reasonCode` is a bounded enum for analytics/explanations, not raw reasoning.

## Structured outputs

Use Groq's strict JSON-schema path if supported for the exact request configuration. Validate again server-side with Zod and engine legality.

Failure sequence:

1. primary request;
2. one constrained schema-repair retry if time permits;
3. deterministic fallback action;
4. record failure and provider health impact.

The model never gets a second chance to choose a strategically different action after seeing that the first was illegal; repair should be constrained to the intended legal representation where possible.

## Privacy

Each call includes one seat's private cards. Treat Groq as a private-information processor.

Before mainnet:

- establish data retention terms;
- disable unnecessary logging;
- separate production API credentials;
- use per-environment projects;
- encrypt stored request/response payloads;
- redact raw private observations from normal logs;
- define whether high-stakes leagues require dedicated/private inference later.

## Capacity and rate limits

Build an inference admission controller:

- requests per minute;
- tokens per minute;
- concurrent calls;
- per-table background-call limits;
- priority for on-turn final decisions;
- circuit breaker on provider degradation.

Final action calls have priority over background cognition.

## Model bake-off inside Season 1

Even after choosing GPT-OSS 120B, run a mandatory acceptance benchmark:

- at least tens of thousands of decisions;
- complete HU and six-max simulated sessions;
- p50/p95/p99 latency;
- timeout/429/error rate;
- invalid schema rate;
- illegal action rate after validation;
- bb/100 against deterministic baselines;
- profile separation;
- consistency across repeated observations;
- context-size behavior;
- cost per hand/session.

If the model fails launch SLOs, do not conceal it. Keep the provider abstraction and select a new standardized Season 1 model through a deliberate model-policy version.

## Profile separation tests

Quantify whether presets produce distinct behavior:

- VPIP/PFR;
- 3-bet rate;
- postflop aggression;
- bluff frequency estimates;
- bet-size distribution;
- Energy allocation;
- public action cadence;
- variance/drawdown;
- opponent adaptation.

Require statistically meaningful separation while ensuring none is trivially dominant.

## Fallback controller

The fallback must be deterministic, legal, and public in policy. It may use a simple precomputed strategy or conservative rules.

Behavior:

- check if legal in low-risk generic fallback;
- otherwise choose policy-driven call/fold based on a frozen rule set;
- never produce an illegal amount;
- mark `fallbackUsed=true`;
- pause table between hands after a provider-outage threshold.

A provider outage must not arbitrarily fold a high-value hand if a safer deterministic policy can act, but the fallback must remain simple enough to audit.

## Acceptance checklist

- [ ] Exact model ID and policy are pinned and hashed.
- [ ] Only one model is enabled in ranked Season 1.
- [ ] Strict structured output works under load.
- [ ] No external tools are available.
- [ ] Private observations are isolated per seat.
- [ ] Profiles are bounded typed data.
- [ ] Provider errors cannot freeze a table.
- [ ] Profile separation is measurable.
- [ ] Model cost/latency SLOs are documented before Sepolia public test.
