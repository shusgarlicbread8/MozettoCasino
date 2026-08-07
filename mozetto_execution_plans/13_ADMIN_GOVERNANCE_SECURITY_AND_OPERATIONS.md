# 13 — Admin, Governance, Security, and Operations

**Entry gate:** Contract roles, service boundaries, and chain mirrors are defined.  
**Exit gate:** Operations can pause and diagnose the protocol without one key being able to steal funds or rewrite games.

## No super-admin wallet

The admin UI is an operational interface, not an omnipotent private key.

Separate roles:

| Role | Purpose |
|---|---|
| Protocol Safe | upgrades, registry, verifier policy, treasury config |
| Governance Timelock | delays normal privileged changes |
| Emergency Guardian | pause narrowly scoped actions |
| Treasury Safe | receive protocol revenue |
| Session Relayer | submit permission/session transactions |
| Settlement Submitter | submit signed settlements |
| Attestors | verify and sign results |
| VRF Operator | manage VRF funding/configuration |
| Dealer Enclave | private cards/randomness processing |

## Governance

### Safe

Use a multi-signature Safe for protocol administration. Production target should be at least 3-of-5, with geographically/organizationally separated signers.

### Timelock

Normal changes:

```text
proposal → Safe approval → public timelock → execution
```

Timelocked changes include:

- new game template;
- rake changes;
- model/energy policy changes;
- verifier set/policy;
- treasury destination;
- upgrades.

### Emergency guardian

May:

- stop new sessions;
- stop new GamePermissions;
- pause settlement submission under a defined incident;
- disable a compromised game template.

May not:

- withdraw player USDC;
- edit balances;
- replace a settlement;
- redirect fees;
- upgrade contracts.

Design emergency exits so a pause cannot trap users indefinitely.

## Key management

### Hot keys

Relayer and settlement submitter:

- KMS/HSM-backed;
- destination-contract allowlist;
- gas-spend limits;
- no user USDC withdrawal authority;
- rotation runbook;
- anomaly alerts.

### Attestor keys

- separate KMS keys/processes;
- distinct deployment boundaries;
- sign only canonical EIP-712 payloads;
- anti-replay nonce;
- health heartbeat;
- revocation/rotation through governance.

### Dealer keys

- enclave-generated or enclave-protected;
- KMS policy tied to approved attestation measurement;
- no plaintext in parent-host logs.

### Treasury keys

- Safe only;
- no application server custody.

## Admin application

Deploy `apps/admin` separately from the public web app.

Requirements:

- hardware-backed MFA;
- SSO/identity provider;
- role-based access control;
- IP/device policy where appropriate;
- short sessions;
- read-only default;
- every privileged action becomes a proposal/workflow;
- immutable audit log.

## Dashboard sections

### Chain

- chain ID/network;
- latest/safe/finalized block;
- Flashblock/RPC health;
- primary/fallback RPC agreement;
- indexer lag;
- reorg alerts;
- relayer nonce/gas;
- pending transactions.

### Solvency

- Vault token balance;
- active session liabilities;
- pending settlement liabilities;
- accrued fees;
- mirror totals;
- difference.

Show one explicit status:

```text
PROTOCOL SOLVENT
```

Any non-zero unexplained difference automatically pauses new sessions.

### Sessions

- state;
- participants;
- template/engine/model/profile hashes;
- current hand/sequence;
- checkpoint age;
- VRF/deck batch status;
- controller health;
- settlement/attestor status.

Allowed actions are narrow:

- request graceful pause after hand;
- mark under review;
- request replay verification;
- propose recovery through governance.

No “edit stack” button.

### Randomness/dealer

- dealer secret root;
- VRF request/fulfillment;
- deck-batch root;
- hands remaining;
- enclave measurement;
- attestation validity;
- conflicting output alert.

### AI

- Groq status;
- p50/p95/p99 latency;
- 429/error rate;
- invalid schema rate;
- fallback rate;
- background/final request mix;
- token/cost usage;
- profile distribution;
- Energy usage.

### Proof/settlement

- proof-batch freshness;
- unpublished batches;
- replay verifier backlog;
- attestors online;
- pending settlements;
- oldest settlement;
- failed settlement reason.

### Risk

- linked accounts;
- repeated pairs;
- collusion flags;
- withdrawal anomalies;
- session-signer anomalies;
- permission-cap usage.

## Automatic controls

Automatically pause new sessions on:

- Vault reconciliation mismatch;
- two RPCs disagree beyond policy;
- indexer lag beyond safety threshold;
- dealer attestation invalid;
- proof publisher stale beyond risk limit;
- attestor quorum unavailable;
- critical contract event;
- widespread AI failure if fallback policy is insufficient.

Do not automatically block user withdrawal of undisputed idle ArenaAccount funds merely because gameplay is paused.

## Incident runbooks

Create runbooks for:

- relayer compromise;
- session-signer compromise;
- attestor compromise;
- dealer enclave compromise;
- RPC outage/reorg;
- database corruption;
- Redis loss;
- Groq outage;
- settlement backlog;
- Vault mismatch;
- leaked frontend/config secret;
- contract vulnerability.

Each runbook includes detection, immediate containment, user impact, evidence preservation, governance action, recovery, and postmortem.

## Audit trail

Every admin action records:

```text
actor
role
timestamp
request ID
reason
before/after state
related session/contract
Safe proposal/transaction if relevant
approval chain
```

Logs are append-only and exported to a separate security account/storage.

## Security reviews

- smart-contract audit;
- wallet permission review;
- dealer cryptographic review;
- poker-engine review;
- backend penetration test;
- cloud/KMS review;
- threat model updated before every major protocol version.

## Acceptance evidence

- compromised relayer cannot steal USDC;
- compromised session signer remains capped;
- one attestor cannot settle;
- emergency guardian cannot withdraw funds;
- admin cannot edit a user's balance;
- new template/rake policy cannot activate instantly without emergency-specific authority;
- automatic pause fires in reconciliation chaos test;
- key rotation drill succeeds.
