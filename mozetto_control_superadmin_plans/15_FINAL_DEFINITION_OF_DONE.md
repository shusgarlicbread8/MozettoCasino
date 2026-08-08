# Mozetto Control — Final Definition of Done

Control is not "done" because pages render. It is done when operators can safely run Mozetto and the control plane does not create a new custody/security failure mode.

---

## Authentication

- [ ] wallet SIWE is primary admin login;
- [ ] wrong wallets are denied;
- [ ] principals/roles are server enforced;
- [ ] admin cookie is separate from player cookie;
- [ ] nonce replay is impossible;
- [ ] sessions can be revoked;
- [ ] high-impact actions require step-up;
- [ ] break-glass token remains CLI-only/hidden from normal UI.

## Secrets

- [ ] no Protocol Safe private key in app;
- [ ] no Treasury Safe private key in app;
- [ ] no relayer/session signer key in browser;
- [ ] no provider key in browser;
- [ ] configuration page never reveals secret values.

## Audit

- [ ] every mutation creates append-only admin action;
- [ ] actor wallet is recorded;
- [ ] reason is required;
- [ ] before/after is captured where applicable;
- [ ] failed privileged attempts are recorded;
- [ ] audit export exists.

## Custody

- [ ] no generic balance-edit endpoint;
- [ ] no admin withdrawal redirect;
- [ ] solvency page reconciles chain and liabilities;
- [ ] divergence triggers critical state;
- [ ] player funds remain recoverable through protocol mechanisms, not admin goodwill.

## Live poker

- [ ] admin cannot change cards;
- [ ] admin cannot rewrite actions;
- [ ] admin cannot change pot/stack directly;
- [ ] pause happens at safe hand boundary;
- [ ] drain prevents new exposure without corrupting current hand;
- [ ] replay verifier is accessible from session detail.

## Economics

- [ ] gross rake definition frozen;
- [ ] AI/chain/infra COGS separated;
- [ ] contribution margin reproducible;
- [ ] per-city economics exists;
- [ ] player P&L is distinct from platform revenue;
- [ ] exports are audited.

## AI

- [ ] provider health visible;
- [ ] timeout/fallback rates visible;
- [ ] policy/model/profile hashes visible;
- [ ] AgentState persistence visible;
- [ ] provider can be safely disabled for new work;
- [ ] raw chain-of-thought is not stored/displayed;
- [ ] active hand policy cannot be silently rewritten.

## Protocol

- [ ] chain addresses/code hashes visible;
- [ ] randomness lifecycle visible;
- [ ] proof continuity visible;
- [ ] settlement queue visible;
- [ ] attestor health visible;
- [ ] watchtower verification visible;
- [ ] governed changes are proposal-only.

## Incidents

- [ ] incidents have severity/state/owner;
- [ ] critical protocol alarms can create/link incidents;
- [ ] runbooks exist for solvency, settlement, randomness, AI, game server, DB/Redis;
- [ ] admin actions link to incidents.

## UI/UX

- [ ] environment is always visible;
- [ ] stale data cannot look live;
- [ ] metric source/age is available;
- [ ] global search resolves operational entities;
- [ ] every critical action shows impact before confirmation;
- [ ] audit ID is returned after mutation.

## Deployment

- [ ] admin deploy is separate/restricted;
- [ ] CSP/CORS/cookie configuration hardened;
- [ ] migrations reproducible;
- [ ] browser E2E green;
- [ ] security suite green;
- [ ] chaos visibility green;
- [ ] staging incident drill complete;
- [ ] mainnet starts read-only before mutations are enabled.

---

## Final operator test

A qualified operator should be able to receive this hypothetical alert:

> Settlement backlog and reconciliation divergence detected on London $1/$2.

and, using only Mozetto Control, determine:

1. whether player money is currently solvent;
2. which sessions are affected;
3. whether chain/indexer/DB disagree;
4. whether randomness/proofs are valid;
5. whether new exposure should be paused;
6. which safe runtime action to take;
7. what incident was created;
8. which admin actions occurred;
9. whether governance action is required;
10. when the system is safe to resume.

If the operator still needs undocumented database edits, secret keys, or ad-hoc scripts to answer those questions, Control is not finished.
