# WP-086 — Hosted deployment recipes

**Authority:** `mozetto_execution_plans/07_REALTIME_BACKEND_SUPABASE_AND_INFRASTRUCTURE.md` (Deployment / Long-running services)  
**Packet:** `mozetto_execution_plans/16_AGENT_WORK_PACKETS.md` WP-086  
**Date:** 2026-08-07

---

## Goal

Document and wire **hosted recipes for long-lived services** (API, game, dealer, verifier, indexer, settlement worker, agent) — not only the Vercel web app.

No live deploy is required for this packet. Recipes are staging-shaped; Plan 07 warns that Render must not become an unexamined production assumption.

---

## Topology

| Deployable | Dockerfile | Default port | Health | Role |
|---|---|---|---|---|
| **web** (`apps/web`) | — (Vercel) | 3000 | Vercel | Player UI |
| **admin** (`apps/admin`) | — (Vercel / separate) | 3001 | — | Ops UI |
| **api** | `Dockerfile.api` | `PORT` / 4000 | `GET /health` | REST, SIWE, admin, verify |
| **game** | `Dockerfile.game` | `PORT` / 4001 | `GET /health` | Authoritative WS + table actors |
| **agent** | `Dockerfile.agent` | `PORT` / 4002 | `GET /health` | AI action HTTP |
| **dealer** | `Dockerfile.dealer` | `PORT` / 4003 | `GET /health` | Deck commitments / attest |
| **verifier** | `Dockerfile.verifier` | `PORT` / 4004 | `GET /health` | Replay / settlement tip verify |
| **indexer** | `Dockerfile.indexer` | `PORT` / 4010 | `GET /health`, `/metrics` | Vault / chain projection |
| **worker** | `Dockerfile.worker` | `PORT` / 4011 | `GET /health` | Settlement + checkpoints poller |

`packages/proof-batch-publisher` includes an optional `src/run.ts` runner (WP-085). A dedicated publisher Dockerfile can mirror `Dockerfile.worker` when ops wants a separate process; until then, settlement-worker / ops jobs may invoke the package locally.

**Datastores (managed, not in app containers):**

- Supabase Postgres (`DATABASE_URL` — prefer pooler `:6543`)
- Managed Redis (`REDIS_URL`) when running **>1** game replica (WP-080 leases)

Local datastores only: `docker compose up -d` (Postgres 16 + Redis 7).

---

## Recipe A — Render Blueprint

File: [`render.yaml`](../render.yaml)

1. Render → **New** → **Blueprint** → select this repo.
2. Fill `sync: false` secrets in the dashboard (never commit values).
3. After services are up, point Vercel `NEXT_PUBLIC_API_URL` / `NEXT_PUBLIC_GAME_*` at the public api/game URLs.
4. Wire internal URLs:
   - game → `DEALER_URL`, `AGENT_RUNTIME_URL`
   - worker → `REPLAY_VERIFIER_URL`, `DEALER_URL`

**Notes**

- `mozetto-game` must stay a long-lived web service (WebSockets).
- `mozetto-settlement-worker` is a Render **worker** (poll loop); it still binds `/health` if you promote it to a web service later.
- Free-plan Blueprint is staging-oriented. For production-like isolation, put dealer / verifier / agent on private services or IP allowlists.

---

## Recipe B — Fly.io

Configs: [`deploy/fly/`](../deploy/fly/)

```bash
fly apps create mozetto-api-staging
fly secrets set -a mozetto-api-staging DATABASE_URL=... SESSION_SECRET=... # etc
fly deploy -c deploy/fly/api.toml -a mozetto-api-staging
# repeat for game / indexer / dealer / verifier / worker / agent
```

- Keep `auto_stop_machines = false` on game (and usually api) so WS / sessions are not frozen.
- Prefer Fly private networking (`.internal`) for dealer, verifier, agent.
- Multi-replica game: set `REDIS_URL` and run ≥2 machines only after lease fencing is verified.

---

## Recipe C — Docker Compose (prod-ish)

File: [`docker-compose.hosted.yml`](../docker-compose.hosted.yml)

Starts **api / game / dealer / verifier / agent / indexer / worker** against an external `DATABASE_URL` (+ optional `REDIS_URL`). Does not embed Postgres/Redis.

```bash
cp .env.example .env.hosted   # fill managed URLs + keys; do not commit
DATABASE_URL=... pnpm --filter @mozetto/database migrate
docker compose -f docker-compose.hosted.yml --env-file .env.hosted up --build
```

Smoke:

```bash
curl -fsS localhost:4000/health
curl -fsS localhost:4001/health
curl -fsS localhost:4002/health
curl -fsS localhost:4003/health
curl -fsS localhost:4004/health
curl -fsS localhost:4010/health
curl -fsS localhost:4011/health
```

---

## Env checklist (no secret values)

Names only. Full local template: [`.env.example`](../.env.example).

### Shared / platform

| Variable | Used by | Notes |
|---|---|---|
| `NODE_ENV=production` | all | Hosted default |
| `DATABASE_URL` | api, game, dealer, verifier, indexer, worker | Pooler preferred |
| `DATABASE_SSL` | DB clients | `0` only for local non-TLS |
| `MOZETTO_CHAIN_ENV` | api, indexer | `base-sepolia` / `base` / `anvil` |
| `CHAIN_ID` | dealer, verifier, worker | e.g. `84532` |
| `BASE_SEPOLIA_RPC_URL` / `BASE_RPC_URL` / `ANVIL_RPC_URL` | chain-touching services | Never share prod RPC creds with Anvil |

### api

| Variable | Required | Notes |
|---|---|---|
| `SESSION_SECRET` | yes | Cookie / JWT material |
| `WEB_ORIGIN` / `WEB_ORIGINS` | yes (split deploy) | Vercel origin(s) for CORS |
| `COOKIE_SAMESITE=none` + `COOKIE_SECURE=1` | yes when web ≠ api host | Cross-site cookies |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Auth admin client |
| `SUPABASE_SECRET_KEY` | yes | Server secret key |
| `SIWE_DOMAIN` / `SIWE_URI` | yes (wallet) | Match public web host |
| `ADMIN_TOKEN` | ops | Same value as admin app |
| `SESSION_RELAYER_PRIVATE_KEY` | on-chain sessions | Relayer only |
| `INSTANT_SESSION_SIGNER_PRIVATE_KEY` | seat tickets | **Must differ** from relayer / settlement |
| `NEXT_PUBLIC_GAME_HTTP_URL` | optional | API→game proxy hints |

### game

| Variable | Required | Notes |
|---|---|---|
| Same session / Supabase / cookie set as api | yes | Shared auth cookie domain story |
| `REDIS_URL` | multi-replica | Required if >1 game instance |
| `DEALER_URL` | yes (live deal) | Internal URL |
| `AGENT_RUNTIME_URL` | AI seats | Internal URL |
| `OUTBOX_STORE` | default postgres | `memory` tests only |
| `TABLE_LEASE_*` | optional | See WP-080 |

### dealer

| Variable | Required | Notes |
|---|---|---|
| `DEALER_ATTESTOR_PRIVATE_KEY` | attest path | Distinct from game/replay |
| `SETTLEMENT_HUB_ADDRESS` | attest path | Hub verifyingContract |

### verifier (replay-verifier)

| Variable | Required | Notes |
|---|---|---|
| `REPLAY_ATTESTOR_PRIVATE_KEY` | attest path | Distinct role key |
| `SETTLEMENT_HUB_ADDRESS` | attest path | |

### indexer

| Variable | Required | Notes |
|---|---|---|
| `ARENA_VAULT_ADDRESS` | yes to index | Idle health if missing |
| `INDEXER_CONFIRMATIONS` / `INDEXER_POLL_MS` | defaults ok | |
| `DEPLOYMENT_BLOCK` | rebuilds | Start cursor |
| `PORT` or `INDEXER_HEALTH_PORT` | hosted | Health bind |

### worker (settlement-worker)

| Variable | Required | Notes |
|---|---|---|
| `SETTLEMENT_PRIVATE_KEY` | settle txs | Can be relayer; **not** an attestor fallback in prod |
| `GAME_ATTESTOR_PRIVATE_KEY` | quorum | Distinct |
| `REPLAY_ATTESTOR_PRIVATE_KEY` | quorum | Distinct |
| `DEALER_ATTESTOR_PRIVATE_KEY` | quorum | Distinct |
| `ATTESTOR_REQUIRE_DISTINCT_KEYS=1` | staging/prod | WP-065 |
| `SETTLEMENT_HUB_ADDRESS` / `SETTLEMENT_HUB_V3_ADDRESS` | settle | V2 vs V3 hub (WP-084) |
| `SETTLEMENT_HUB_VERSION` | optional | `v2` / `v3` override |
| `CHECKPOINT_REGISTRY_ADDRESS` | checkpoint | |
| `REPLAY_VERIFIER_URL` / `DEALER_URL` | HTTP clients | Internal |
| `ENABLE_MOCK_VRF` | **must be 0** off Anvil | |
| `SETTLEMENT_POLL_MS` | default 15000 | |
| `SETTLEMENT_HEALTH=0` | optional | Disable health HTTP |

### agent-runtime

| Variable | Required | Notes |
|---|---|---|
| `GROQ_API_KEY` | live Season 1 model | Optional for mock `/v1/act` |

### web (Vercel) — pointer only

`NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_GAME_HTTP_URL`, `NEXT_PUBLIC_GAME_WS_URL` (`wss://…/ws`), Supabase publishable URL/key, chain env + vault addresses. See root README Deploy section.

---

## Restart / divergence gate (WP-086)

Wave gate: **component restart must not produce divergent table state.**

Minimum staging checks (manual):

1. Start hosted stack; seat a table; produce a few durable events.
2. `GET /health` on game — note `sequence`, `durableChainOk`, lease fields.
3. Restart **game** only (Render/Fly/Docker restart).
4. Confirm:
   - lease reclaim succeeds (with Redis: fencing; without Redis: single replica only);
   - outbox drains pending rows before new writes (WP-081);
   - `/health` sequence matches Postgres `hand_events` tip (no gap / prev-hash break).
5. Restart **indexer** — cursor resumes; lag recovers without rewriting settled custody incorrectly.
6. Restart **worker** — no double-settle when hub/session already settled (idempotent settle path).

Full chaos automation: `docs/WP-101_CHAOS_SUITE.md` + `scripts/chaos/` (`pnpm test:chaos`).

---

## Security notes

- Never put private keys, DB passwords, or API tokens in docs, git, or Blueprint committed values (`sync: false` / `fly secrets` / platform env UI).
- Separate Anvil / Sepolia / mainnet: DB, Redis, keys, RPC, manifests, buckets, Groq (Plan 07 Environments).
- Dealer secrets and attestor keys stay off the public web origin; prefer private networking.
- `ENABLE_MOCK_VRF=1` is Anvil-only.

---

## Delivered artifacts

| Item | Path |
|---|---|
| Render Blueprint | `render.yaml` |
| Hosted Compose | `docker-compose.hosted.yml` |
| Dockerfiles | `Dockerfile.{api,game,indexer,dealer,verifier,worker,agent}` |
| Fly recipes | `deploy/fly/*.toml` |
| This note | `docs/WP-086_HOSTED_DEPLOYMENT.md` |

**Out of scope:** live deploy; `/specs` mutations; WP-085 publisher container; live multi-container chaos in CI (unit suite is WP-101; see `docs/WP-101_CHAOS_SUITE.md`).
