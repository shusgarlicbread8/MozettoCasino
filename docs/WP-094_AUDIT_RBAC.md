# WP-094 — Audit log and RBAC

**Authority:** `mozetto_execution_plans/13_ADMIN_GOVERNANCE_SECURITY_AND_OPERATIONS.md`, `16_AGENT_WORK_PACKETS.md` WP-094  
**Depends on:** WP-091 admin token gate; Plan 19 §025 admin tables  
**Date:** 2026-08-07

---

## Delivered

| Item | Location |
|---|---|
| Migration (append-only audit + principals + session ops + RLS) | `packages/database/migrations/022_admin_audit_rbac.sql` |
| Append-only write path | `packages/database/src/admin-audit.ts` |
| RBAC (read vs mutate) | `services/api/src/admin-auth.ts` — enforced on all `/v1/admin/*` |
| Mutate API + audit | `POST /v1/admin/sessions/:sessionId/ops` |
| Audit / whoami APIs | `GET /v1/admin/audit`, `GET /v1/admin/whoami` |
| Admin UI | `/audit`, session ops panel, middleware accepts role tokens |
| This note | `docs/WP-094_AUDIT_RBAC.md` |

---

## Goal

Hardware MFA-ready **separate admin deployment** with:

1. Immutable audit log for privileged admin mutations  
2. Role-based access — **read** vs **mutate** — on the admin API  
3. Read-only default (Plan 13)

---

## Roles and capabilities

| Role (token) | Env | Capabilities |
|---|---|---|
| `viewer` | `ADMIN_READ_TOKEN` | `read` |
| `operator` | `ADMIN_MUTATE_TOKEN` | `read` + `mutate` |
| `admin` | `ADMIN_TOKEN` (legacy / break-glass) | `read` + `mutate` |
| `risk` | (DB `admin_roles` / future SSO) | `read` (sensitive signals later) |

`ADMIN_TOKEN` alone remains backward-compatible with WP-091 (full admin). Prefer distinct read vs mutate tokens in staging/prod.

Optional header `x-admin-actor` stamps a human label on audit rows (SSO subject later).

---

## Audit trail

Canonical table: **`admin_actions`** (enriched in migration 022).

Every privileged mutation records Plan 13 fields: actor, role, timestamp, request id, reason, before/after, entity, optional Safe tx id.

**Append-only:** DB triggers reject `UPDATE` / `DELETE` on `admin_actions`. Application path is insert-only via `appendAdminAction` / `mutateSessionOps`.

RLS enabled on admin tables with **no permissive policies** (service role / owner bypasses; anon JWT denied by default). Do not add `using (true)`.

`admin_principals` stores SSO subjects + `mfa_required` for future IdP binding — **no raw tokens** in the database or browser `NEXT_PUBLIC_*`.

---

## Narrow mutate actions (Plan 13)

`POST /v1/admin/sessions/:sessionId/ops` with `{ action, reason }`:

- `pause_after_hand` / `clear_pause_after_hand`
- `mark_under_review` / `clear_under_review`
- `request_replay` / `clear_replay`

Stored in `admin_session_ops` overlays — **does not** edit stacks, balances, or settlement outcomes. Reason required. Each call inserts `admin_actions`.

Recovery via governance / Safe remains WP-093.

---

## Separate admin deploy + MFA readiness

| Requirement | Status |
|---|---|
| Deploy `apps/admin` separately from public web | Documented (WP-086 / README); own Vercel project or host |
| Hardware-backed MFA | **Ready:** terminate Cloudflare Access / Okta / IdP WebAuthn **in front of** admin origin before tokens |
| SSO / short sessions | IdP session at edge; admin cookie remains short-lived ops token |
| Secrets out of browser bundle | Tokens only via httpOnly-ish cookie set at `/login` or server `ADMIN_*` env — never `NEXT_PUBLIC_ADMIN_*` |
| Read-only default | Issue viewers `ADMIN_READ_TOKEN` only |

Production checklist:

1. Separate Vercel (or equivalent) project for `apps/admin`  
2. Edge MFA/SSO → only then allow `/login?token=` or inject cookie from a trusted broker  
3. API and admin share the same token secrets via server env  
4. Export `admin_actions` periodically to a separate security account/storage (Plan 13)

---

## API summary

| Method | Path | Capability |
|---|---|---|
| GET | `/v1/admin/whoami` | read |
| GET | `/v1/admin/audit` | read |
| GET | `/v1/admin/*` (overview, solvency, sessions, …) | read |
| POST | `/v1/admin/sessions/:sessionId/ops` | **mutate** |

Auth: `x-admin-token` header or `admin_token` cookie.

---

## Commands / evidence

```bash
pnpm --filter @mozetto/database test
pnpm --filter @mozetto/database typecheck
pnpm --filter @mozetto/api test
pnpm --filter @mozetto/api typecheck
pnpm --filter @mozetto/admin typecheck
# Apply migration when DB available:
# pnpm --filter @mozetto/database migrate
```

```bash
# Read token → whoami
curl -s -H "x-admin-token: $ADMIN_READ_TOKEN" http://localhost:4000/v1/admin/whoami

# Mutate without mutate token → 403
curl -s -X POST -H "x-admin-token: $ADMIN_READ_TOKEN" -H 'content-type: application/json' \
  -d '{"action":"mark_under_review","reason":"test"}' \
  http://localhost:4000/v1/admin/sessions/SESSION/ops
```

---

## Out of scope

- Spec mutations  
- Weakening RLS / browser private keys  
- Full SSO provider integration (hooks only: `admin_principals`)  
- Safe/timelock signing in browser (WP-093)  
- Editing player balances

---

## Follow-up

- Wire IdP group → `admin_principals.role`  
- External SIEM export of `admin_actions`  
- Consume `pause_after_hand` in game-server epoch boundary  
- WP-093 governance proposals for recovery actions
