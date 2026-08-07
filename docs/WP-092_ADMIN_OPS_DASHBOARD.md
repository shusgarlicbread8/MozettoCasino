# WP-092 — Admin session / randomness / AI dashboard

**Authority:** `mozetto_execution_plans/13_ADMIN_GOVERNANCE_SECURITY_AND_OPERATIONS.md` (Dashboard sections: Sessions, Randomness/dealer, AI)  
**Packet:** `16_AGENT_WORK_PACKETS.md` WP-092  
**Coordinate:** WP-091 owns chain/solvency on the overview surface; this packet owns ops investigation views.  
**Date:** 2026-08-07

---

## Delivered

| Item | Location |
|---|---|
| Session list + investigation detail | `apps/admin/src/app/sessions/` |
| Randomness / dealer epochs UI | `apps/admin/src/app/randomness/page.tsx` |
| AI provider health UI | `apps/admin/src/app/ai/page.tsx` |
| Token-gated read APIs | `services/api/src/admin.ts` |
| Health classification helpers + tests | `services/api/src/admin-ops.ts` (+ `.test.ts`) |
| Nav split (ops vs solvency) | `apps/admin/src/app/layout.tsx`, `page.tsx` |
| This note | `docs/WP-092_ADMIN_OPS_DASHBOARD.md` |

No `/specs` mutations. **No settlement mutation** from admin UI or these endpoints.

---

## Goal

Operational health and investigation dashboard: sessions, randomness epochs, AI provider health / fallback rates — **read-only**.

---

## API (ADMIN_TOKEN)

All routes require `x-admin-token` or `admin_token` cookie matching `ADMIN_TOKEN`.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/v1/admin/sessions` | List on-chain sessions (+ checkpoint age, latest VRF status, fallback count) |
| `GET` | `/v1/admin/session/:sessionId` | Investigation payload: players, checkpoints, dealer, randomness epochs, proposals, recent AI invocations, table epochs, emergency exits |
| `GET` | `/v1/admin/randomness` | Epoch status counts, stale pending, dealer commitments, indexed beacon events |
| `GET` | `/v1/admin/ai/health?windowHours=24` | Fallback rate, latency p50/p95/p99, token/energy aggregates, model/mode mix, recent fallbacks |

Existing `/v1/admin/overview` remains the chain/solvency pointer for WP-091.

Responses include `readOnly: true` where applicable.

---

## Admin UI

Deployed separately (`apps/admin`, port 3001). Token via `/login?token=…` (cookie) — production must front with MFA/SSO; RBAC/audit in WP-094 (`docs/WP-094_AUDIT_RBAC.md`).

| Route | Content |
|---|---|
| `/sessions` | Ops session table → detail |
| `/sessions/[sessionId]` | Commitments, participants, VRF health, settlement attestor counts, recent AI |
| `/randomness` | Epoch funnel + dealer roots + chain events |
| `/ai` | Groq health classification, latency, fallbacks |

Allowed actions remain **none** for settlement/stack edits. Links to public `/verify/:sessionId` only.

---

## Health policy (AI)

`classifyAiHealth` defaults (tunable later via ops config, not hardcoded product mutation):

| Signal | Degraded | Critical |
|---|---|---|
| Fallback rate | ≥ 5% | ≥ 25% |
| p95 latency | ≥ 8s | ≥ 20s |
| No samples | `unknown` | — |

Randomness epochs: `fulfilled`→healthy, `failed`→failed, open &gt;5m→stale, else pending.

---

## Security notes

- Admin token is an ops gate, not a chain super-admin wallet.
- Never ship Safe/session-signer private keys to the browser.
- AI endpoint returns aggregates only — no Groq API keys.
- Randomness UI shows public dealer/VRF roots and fulfillment metadata only.

---

## Commands

```bash
pnpm --filter @mozetto/api test
pnpm --filter @mozetto/api typecheck
pnpm --filter @mozetto/admin typecheck
```

---

## Not in scope

- WP-091 chain head / Flashblock / full solvency equality UI
- WP-093 Safe proposal signing from browser
- WP-094 RBAC / audit log / hardware MFA (DONE)
- Mutating pause/under-review workflows (narrow actions land with governance later)
