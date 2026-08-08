# Mozetto Control — Admin Authentication and Security

## 1. Security boundary

Admin authentication proves **who is operating Control**. It does not confer protocol ownership.

Primary login:

```text
MetaMask / compatible wallet
→ SIWE challenge
→ allowlist + admin_principals
→ dedicated admin session
→ Control
```

Legacy tokens remain for scripts and break-glass use only.

---

## 2. Admin SIWE flow

### Step 1 — request nonce

```http
GET /v1/admin/auth/nonce
```

Response:

```json
{
  "nonce": "...",
  "domain": "control.mozetto...",
  "uri": "https://control...",
  "chainId": 8453,
  "issuedAt": "...",
  "expiresAt": "..."
}
```

Persist nonce server-side with:

```text
nonce_hash
issued_at
expires_at
consumed_at
request_ip_hash
user_agent_hash
```

Nonce must be single-use.

### Step 2 — sign SIWE

The message must bind:

- domain;
- URI;
- chain ID;
- nonce;
- issue time;
- expiry;
- statement such as `Sign in to Mozetto Control`.

### Step 3 — verify

```http
POST /v1/admin/auth/verify
```

Server checks:

1. signature recovers address;
2. SIWE domain exactly matches configured admin domain;
3. URI is expected;
4. chain ID is allowed;
5. nonce exists, unexpired, unconsumed;
6. checksum-normalized address is allowlisted;
7. `admin_principals.subject == lower(address)` exists and is active;
8. role/capabilities resolved;
9. nonce marked consumed transactionally;
10. admin session issued.

---

## 3. Session model

Cookie:

```text
mozetto_admin_session
HttpOnly
Secure in hosted envs
SameSite=Strict
Path=/
```

Use a **different signing secret and cookie name** from player auth.

Recommended session TTL:

- normal: 4–8 hours;
- idle timeout: 30–60 minutes;
- mutate step-up freshness: 5–15 minutes.

Store session server-side for revocation.

Suggested migration:

```sql
admin_sessions(
  id uuid primary key,
  principal_id uuid not null,
  wallet_address text not null,
  role text not null,
  capabilities jsonb not null,
  created_at timestamptz not null,
  last_seen_at timestamptz not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by text,
  auth_method text not null,
  ip_hash text,
  user_agent_hash text
)
```

---

## 4. Roles and capabilities

Do not model authorization as only `admin=true`.

Recommended roles:

### `viewer`

Read dashboards only.

### `support`

Player/session inspection, notes, replay request, no platform controls.

### `risk`

Integrity review, player matchmaking restriction, incident participation.

### `operator`

Pause/drain/resume safe runtime operations.

### `finance`

Economics/treasury exports and reconciliations; no fund transfer authority.

### `auditor`

Read all audit/verification surfaces; no mutations.

### `superadmin`

All Control capabilities, but still **not** Safe/private-key authority.

Represent permissions explicitly:

```text
admin.read
players.read
players.restrict_matchmaking
sessions.pause_after_hand
sessions.resume
sessions.request_replay
matchmaking.pause
ai.disable_provider
incidents.manage
economics.export
governance.prepare
admin.manage_principals
```

---

## 5. Step-up authentication

Require a fresh wallet signature for high-impact actions such as:

- platform-wide matchmaking pause;
- AI provider disable across production;
- city drain;
- principal/role changes;
- emergency incident resolution;
- governance proposal generation for critical contracts.

The confirmation message should contain the action digest:

```text
Mozetto Control privileged action
Action: PAUSE_RANKED_MATCHMAKING
Environment: MAINNET
Reason: INC-2026-014
Request ID: ...
Expires: ...
```

This prevents a stale browser session from silently performing a critical mutation.

---

## 6. Allowlist strategy

Environment:

```text
ADMIN_SUPERADMIN_ADDRESSES=<comma-separated checksummed addresses>
```

Database:

```text
admin_principals.subject = lower(wallet)
```

Recommended rule:

```text
production access = env allowlist AND active DB principal
```

Why both:

- environment protects first bootstrap;
- DB allows role/revocation/audit workflows;
- compromise of one source does not automatically grant full access.

For additional operators later, move to approved principal provisioning rather than constantly editing env vars.

---

## 7. Break-glass token path

Keep:

```text
ADMIN_READ_TOKEN
ADMIN_MUTATE_TOKEN
ADMIN_TOKEN
```

but constrain them:

- never expose through normal login;
- never put in `NEXT_PUBLIC_*`;
- never store in browser localStorage;
- prefer CLI header `x-admin-token`;
- production mutate tokens stored in secret manager;
- token use generates audit event `authMethod=token`;
- allow IP/network restrictions;
- rotate regularly;
- support immediate revocation.

UI may expose token login only under an explicit local/dev `?breakglass=1` route and preferably never in production.

---

## 8. Middleware is not authorization

`apps/admin/src/middleware.ts` is for UX routing only.

Every `/v1/admin/*` endpoint must independently enforce authorization server-side.

Never rely on:

```text
middleware passed → endpoint trusted
```

---

## 9. CSRF and request integrity

Cookie-based mutations require CSRF protection.

Recommended:

- SameSite Strict;
- Origin/Referer validation;
- CSRF token for non-idempotent browser requests;
- request ID;
- idempotency key for critical actions;
- body-size limits;
- Zod/schema validation.

---

## 10. Audit requirements

Log:

- successful login;
- failed login;
- unauthorized wallet;
- role/capability failure;
- session revoke;
- principal changes;
- break-glass token use;
- step-up signatures;
- every mutation.

Do not log raw wallet signatures unnecessarily after verification.

---

## 11. Security acceptance tests

Must test:

```text
wrong wallet → 401/403
unlisted but DB-admin wallet → denied
listed but disabled principal → denied
replayed nonce → denied
expired nonce → denied
wrong SIWE domain → denied
wrong chain ID → denied
revoked session → denied
viewer mutation → denied
operator finance-only action → denied
browser never receives admin tokens
legacy token still works in CLI
wallet mutation creates admin_actions row
```
