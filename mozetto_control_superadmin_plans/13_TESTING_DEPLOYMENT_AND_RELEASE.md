# Mozetto Control — Testing, Deployment and Release

## 1. Environments

```text
LOCAL / ANVIL
STAGING / BASE SEPOLIA
PRODUCTION / BASE MAINNET
```

Control must show environment explicitly at all times.

---

## 2. Test layers

### Unit

- SIWE nonce/session;
- allowlist;
- capabilities;
- audit append;
- metric serializers;
- economics calculations;
- action validators.

### API integration

- auth + session cookie;
- role enforcement;
- read/mutate separation;
- idempotency;
- audit creation;
- stale dependency behavior.

### Browser E2E

- allowed wallet login;
- denied wallet;
- shell gate;
- player search;
- session pause-after-hand;
- AI provider disable flow;
- governance preview/export;
- logout/session revoke.

### Security

- nonce replay;
- CSRF;
- privilege escalation;
- forged role cookie;
- token leakage scan;
- direct API bypass of middleware;
- XSS on admin reason/note fields.

---

## 3. Mainnet safety test cases

### No balance mutation

Search routes/code for forbidden generic balance edit APIs.

### No browser private keys

Bundle scan must fail if known private-key env names are imported client-side.

### Chain changes proposal-only

Governance UI creates JSON/calldata, not direct signer execution.

### Live hand safety

Pause/drain operations cannot modify current hand state.

---

## 4. Chaos scenarios

Extend existing chaos suite to include Control visibility:

- game-server killed;
- Redis unavailable;
- DB disconnect;
- indexer lag;
- settlement worker restart;
- AI provider outage;
- replay verifier unavailable;
- VRF pending;
- RPC primary down;
- reconciliation mismatch fixture.

Acceptance: Control correctly transitions health/status and exposes safe action.

---

## 5. Deployment architecture

Prefer separate admin hostname:

```text
control.mozetto...
```

with:

- restricted ingress where possible;
- separate CSP;
- no indexing;
- no public sitemap;
- strict CORS to API;
- dedicated admin cookie;
- production secret manager.

---

## 6. Release sequence

### Stage 1 — Local

SIWE against local allowed wallet, all pages, fake/test data.

### Stage 2 — Sepolia internal

Real hosted API/admin, real admin SIWE domain, Base Sepolia chain views.

### Stage 3 — Sepolia operations drill

Run incidents, pause/resume, provider outage, settlement backlog, governance proposal export.

### Stage 4 — Mainnet read-only

Deploy Control with mutations disabled except audit-safe reads.

### Stage 5 — Mainnet limited ops

Enable Tier 1/2 runtime controls.

### Stage 6 — Governance integration

Enable proposal preparation after Safe/timelock addresses are verified.

---

## 7. Rollback

Control deployment rollback must not affect protocol funds.

If admin frontend/API is broken:

- player app continues;
- workers continue;
- protocol continues according to runtime health;
- emergency external runbooks remain available.

---

## 8. Release checklist

```text
[ ] all migrations applied
[ ] admin session secret configured
[ ] allowed wallet(s) configured
[ ] DB principals active
[ ] SIWE domain/URI exact
[ ] HTTPS/Secure cookie
[ ] wrong-wallet test
[ ] role escalation test
[ ] audit append test
[ ] token break-glass CLI test
[ ] no secrets in frontend bundle
[ ] overview stale-state test
[ ] solvency alert test
[ ] pause-after-hand test
[ ] AI provider disable test
[ ] governance proposal-only test
[ ] incident workflow test
[ ] typecheck/tests green
```
