# 18 — Sources and Decision Log

## Source basis

This plan pack consolidates:

- the uploaded **Mozetto Platform Architecture** document describing Arena Account V2, GamePermission, ArenaVaultV2, PokerSettlementHubV2, Anvil deployment, NLHE HU/6-max split, dealer/replay/indexer/worker services, and current gaps;
- the uploaded consolidated discussion covering Base anchoring, deck commitments, proof batching, continuous AI cognition, Energy, universal rake, and one-model MVP;
- the current technical status report provided in conversation.

The plans preserve the current V2 custody design and introduce versioned V3 specifications and supporting contracts/services rather than discarding working code.

## Official technical references checked

### Groq

- GPT-OSS 120B model documentation: `https://console.groq.com/docs/model/openai/gpt-oss-120b`
- Supported production models: `https://console.groq.com/docs/models`
- Structured Outputs: `https://console.groq.com/docs/structured-outputs`
- Reasoning controls: `https://console.groq.com/docs/reasoning`

Key implementation implications:

- use model ID `openai/gpt-oss-120b`;
- use strict JSON schema where supported;
- use provider health/rate-limit controls;
- do not enable Groq built-in web/code tools for ranked poker.

### Base

- Flashblocks: `https://docs.base.org/base-chain/flashblocks`
- Base Account spend permissions: `https://docs.base.org/base-account/improve-ux/spend-permissions`
- Spend Permission contract reference: `https://docs.base.org/base-account/reference/onchain-contracts/spend-permissions`

Key implementation implications:

- Base can provide fast transaction feedback but poker actions should still be off-chain;
- a one-time bounded permission is the right model for popup-free play;
- custom GamePermission remains valuable because it encodes game-specific limits beyond a generic token allowance.

### Chainlink VRF

- VRF overview: `https://docs.chain.link/vrf`
- VRF v2.5 supported networks: `https://docs.chain.link/vrf/v2-5/supported-networks`
- Security considerations: `https://docs.chain.link/vrf/v2-5/security`

Key implementation implications:

- use request IDs to bind fulfillments;
- never reroll/cancel because an outcome is undesirable;
- bind participant/secret commitments before requesting randomness;
- VRF must be combined with private committed entropy so the public cannot derive the deck.

### AWS Nitro Enclaves

- Nitro Enclaves overview: `https://docs.aws.amazon.com/enclaves/latest/user/nitro-enclave.html`
- Cryptographic attestation: `https://docs.aws.amazon.com/enclaves/latest/user/set-up-attestation.html`
- KMS integration: `https://docs.aws.amazon.com/enclaves/latest/user/kms.html`

Key implementation implications:

- isolate dealer secrets/decks from the parent host;
- use attestation-bound KMS policies;
- publish approved enclave measurements;
- still describe launch honestly as attested confidential dealing rather than full threshold mental poker.

## Locked decision log

### D-001 — Preserve Arena Account V2 architecture

**Decision:** Keep ArenaAccount + GamePermission + ArenaVaultV2 foundations.  
**Reason:** Correct non-custodial idle-fund and seamless-play model already exists.

### D-002 — Base + USDC

**Decision:** Base for settlement, USDC for real-value play.  
**Reason:** Existing architecture and wallet stack are built around it.

### D-003 — Off-chain poker, on-chain custody/proofs/settlement

**Decision:** Do not put every action on-chain.  
**Reason:** Private cards, real-time UX, gas efficiency, and scale.

### D-004 — One model for launch

**Decision:** Ranked Season 1 uses Groq GPT-OSS 120B only.  
**Reason:** Simpler fairness, very fast inference experiment, fewer balancing and fee complications.

### D-005 — Bounded profile customization

**Decision:** Users tune typed strategy axes; no arbitrary ranked prompts.  
**Reason:** Prevent prompt injection/solver access while retaining ownership and differentiation.

### D-006 — Continuous cognition

**Decision:** AI may think throughout the hand using event-driven calls.  
**Reason:** More realistic autonomous player behavior and opponent modelling.

### D-007 — 100 Energy per hand

**Decision:** Equal Energy resets every hand; no carryover in Season 1.  
**Reason:** Simple, auditable compute fairness and predictable COGS.

### D-008 — Universal capped rake

**Decision:** One rake schedule; no model fee or performance fee in Season 1.  
**Reason:** Clear UX, simple settlement, AI cost internalized.

### D-009 — Ranked random matchmaking

**Decision:** No public ranked table/opponent selection.  
**Reason:** Reduce collusion, chip dumping, targeting, and rating farming.

### D-010 — Account-owned HU rating

**Decision:** Glicko-2 rating belongs to user account.  
**Reason:** Agents are loadouts and must not become smurf identities.

### D-011 — Rust future canonical engine

**Decision:** Build Rust in parallel; promote only after parity.  
**Reason:** Determinism, WASM verification, replay, future zkVM compatibility.

### D-012 — Attested dealer first, ZK/MPC later

**Decision:** Nitro-style confidential dealer for launch; interface supports future proof systems.  
**Reason:** Practical private-card protection without pretending full mental poker already exists.

## Change-control rule

A decision above may be changed only by:

1. a written architecture decision record;
2. impact analysis across contracts, engine, proofs, AI, UI, and economics;
3. updated protocol version where consensus behavior changes;
4. migration and historical-verification plan;
5. explicit approval before agents implement the change.
