# Mozetto Control — Chain, Solvency, Randomness, Proofs and Settlement

## 1. Goal

Give operators one protocol truth surface while preserving the rule that chain authority is external to the UI.

---

## 2. Solvency page

Required invariant display:

```text
ArenaVault USDC assets
= open session locked liabilities
+ accrued protocol fees
(+/- explicitly documented states)
```

Show:

- latest reconciliation;
- difference;
- confirmation age;
- indexer cursor;
- source block;
- RPC endpoint health;
- last successful independent watchtower check.

If difference != 0:

```text
CRITICAL
```

and auto-link/create incident.

---

## 3. Chain page

Show per network:

```text
chain id
RPC health
latest block
Base block lag
contract addresses
code hash
expected manifest version
deployment block
Safe addresses
timelock address
```

Detect:

- null expected contract addresses;
- address mismatch;
- code-hash mismatch;
- chain-id mismatch;
- stale manifest.

---

## 4. Randomness page

For each randomness epoch/session:

```text
dealer secret root
VRF request id
request block
confirmations
fulfillment block
random value commitment/bind state
deck batch root
hands consumed
attestation state
```

Statuses:

```text
COMMITTED
VRF_PENDING
VRF_FULFILLED
DECK_BATCH_REGISTERED
DEGRADED
FAILED
```

Never display private dealer secret material.

---

## 5. Proof page

Show:

```text
checkpoint id
session root
hand root
balance root
proofBatchHash
globalRoot
registry tx
inclusion proof status
continuity status
watchtower status
```

Detect gaps in proof-batch sequence.

---

## 6. Settlement page

Queues:

```text
READY_TO_SETTLE
WAITING_ATTESTORS
SUBMISSION_PENDING
CONFIRMING
SETTLED
RETRY
FAILED
EMERGENCY_ELIGIBLE
```

Fields:

```text
session
participants
final balances
rake
settlement digest
attestor signatures
quorum
submission tx
confirmations
age
retry count
```

---

## 7. Attestor health

Show each attestor:

```text
id
health
last signed
version
allowed environment
signature lag
error rate
```

Control must not reveal attestor private keys.

---

## 8. Watchtower integration

Surface independent verification as a separate signal.

Do not let the same server that produced a proof be the only green check beside it.

Recommended statuses:

```text
OPERATOR VERIFIED
WATCHTOWER VERIFIED
BOTH VERIFIED
MISMATCH
PENDING
```

---

## 9. Operational controls

Allowed:

- request reconciliation;
- request watchtower run;
- retry worker processing where idempotent;
- pause new on-chain matchmaking;
- drain affected city;
- open incident.

Proposal-only:

- change verifier router;
- change quorum;
- change GameTemplate;
- change fee treasury;
- change registry parameters;
- protocol upgrade.

---

## 10. Emergency exit UX

Control may show:

```text
session eligible: yes/no
reason
time threshold
proof availability
user-facing recovery instructions
```

Do not make admin the sole party able to release funds if protocol design provides user-side recovery.
