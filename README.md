# Mozetto Arena

Autonomous AI poker platform monorepo — demo world (email) and on-chain world (wallet SIWE on Base).

- **NLHE cash** — authoritative TypeScript game server, mock AI profiles, USDC-style ledgers
- **Dual accounts** — Demo and On-chain are separate profiles (sign out to switch worlds)
- **Supabase Postgres** — profiles, tables, hands, events, ledger (or local Docker Postgres)
- **Base / Anvil** — Arena vault + ArenaAccount V2 custody path

Pinned tool versions: [docs/TOOL_VERSIONS.md](docs/TOOL_VERSIONS.md) (Node 22, pnpm 9.15.0, Foundry v1.7.1, Postgres 16, Redis 7).

## Quick start (fresh clone → local E2E)

**One command** (preferred):

```bash
# Requires Docker for local Postgres, or a real DATABASE_URL in .env.local
pnpm bootstrap --docker-db --reset
pnpm readiness
pnpm e2e:arena-account
```

What `pnpm bootstrap` does:

1. Checks Node / pnpm / Foundry prerequisites  
2. `pnpm install --frozen-lockfile`  
3. Creates `.env.local` from `.env.example` **only if missing** (never overwrites existing secrets)  
4. Optionally starts Docker Postgres 16 + Redis 7 (`--docker-db`)  
5. Applies migrations `001`–`016`  
6. Starts/resets Anvil (chain **31337**) and deploys the V2 stack (`--reset` forces a clean chain)  
7. Boots API, game-server, and related services (unless `--no-start`)  
8. Prints a **readiness report** (ports, health, chain id, key addresses)

### DATABASE_URL (required — be honest)

| Option | When to use |
|--------|-------------|
| **Supabase pooler** (port `6543`) | Shared/dev project; set in `.env.local` before bootstrap |
| **Local Docker** | `pnpm bootstrap --docker-db` sets `postgresql://mozetto:mozetto@127.0.0.1:5432/mozetto` if URL is still a placeholder |

Without a real `DATABASE_URL`, migrations / API / `pnpm e2e:arena-account` will fail. Direct `db.*.supabase.co:5432` is often IPv6-only — use the pooler.

### Clean reset

```bash
pnpm reset:local          # kill Anvil, redeploy contracts, sync .env.local addresses
pnpm reset:local -- --db  # also wipe local Docker Postgres volume + re-migrate
```

### Manual sequence (equivalent)

```bash
cp .env.example .env.local   # only if missing — then set DATABASE_URL + secrets
pnpm install
docker compose up -d         # optional local DB
pnpm db:migrate
./scripts/reset-local.sh     # Anvil + DeployLocal + codegen
./scripts/start-local.sh     # services
./scripts/readiness-report.sh
pnpm e2e:arena-account
```

Open http://localhost:3000 → **Play Demo** or **Enter On-chain**.

**Product freeze:** finish `deposit → lock → play → settle → withdraw` on Base Sepolia before casino/tournament/shop work. See [contracts/README.md](contracts/README.md) and [docs/MAINNET_READINESS.md](docs/MAINNET_READINESS.md).

## Deploy

### Services topology

| Service | Host | Notes |
|---------|------|--------|
| **web** (`apps/web`) | Vercel | Player UI, wallet, arena |
| **admin** (`apps/admin`) | Vercel (separate project) or same team | Ops dashboard — port 3001 locally; protect with MFA in production |
| **api** (`services/api`) | Render / Docker | REST, SIWE, admin + verify endpoints |
| **game-server** | Render / Docker | WebSocket NLHE tables; optional `REDIS_URL` leases |
| **chain-indexer** | Render / Docker (`Dockerfile.indexer`) | Sole authority for vault deposit mirror |
| **settlement-worker** | Render / Docker | Checkpoints, settlement proposals |
| **dealer** | Render / Docker | Dealer commitments + secrets |
| **replay-verifier** | Render / Docker | Replay attestations |
| **agent-runtime** | Render / Docker | Live Groq / mock AI seats (WP-107) |

### Web (Vercel)

The Next.js app lives in `apps/web`. Root `vercel.json` builds with pnpm from the monorepo root.

1. Import the GitHub repo in Vercel (or `cd apps/web && vercel --prod`).
2. Set **Root Directory** to `apps/web` (uses `apps/web/vercel.json` to install/build from the monorepo root).
3. Add env vars (at least):

| Variable | Notes |
|----------|--------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable key |
| `NEXT_PUBLIC_API_URL` | Public API base (https://…) |
| `NEXT_PUBLIC_GAME_HTTP_URL` | Game HTTP base |
| `NEXT_PUBLIC_GAME_WS_URL` | `wss://…/ws` |
| `NEXT_PUBLIC_CHAIN_ENV` | `base-sepolia` or `base` |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | Optional, for WalletConnect |
| `NEXT_PUBLIC_ARENA_VAULT_ADDRESS` | Optional until contracts deployed |

### Admin (Vercel or local)

Minimal ops UI at `apps/admin` (port **3001**). Deploy as a **separate** project from public web. Auth: `ADMIN_READ_TOKEN` (view) and/or `ADMIN_MUTATE_TOKEN` / `ADMIN_TOKEN` (privileged). Log in via `/login?token=…` or `x-admin-token`. **Production: hardware MFA/SSO in front** — see [`docs/WP-094_AUDIT_RBAC.md`](docs/WP-094_AUDIT_RBAC.md).

```bash
pnpm --filter @mozetto/admin dev
```

Env: `API_URL`, `ADMIN_TOKEN` (and optional read/mutate tokens), optional `WEB_ORIGIN` / `NEXT_PUBLIC_WEB_ORIGIN` for verify links. Never put admin tokens in `NEXT_PUBLIC_*`.

### API + long-lived services (not Vercel)

Long-lived Node + WebSockets/workers are required for matchmaking, tables, dealer, verification, indexing, and settlement. **Do not** put these on Vercel.

Full recipes + per-service env checklists: **[`docs/WP-086_HOSTED_DEPLOYMENT.md`](docs/WP-086_HOSTED_DEPLOYMENT.md)**.

| Recipe | Entry |
|--------|--------|
| **Render Blueprint** | `render.yaml` |
| **Fly.io** | `deploy/fly/*.toml` |
| **Docker Compose (prod-ish)** | `docker-compose.hosted.yml` (external `DATABASE_URL` / `REDIS_URL`) |

Dockerfiles:

- `Dockerfile.api` → REST API (`:4000`)
- `Dockerfile.game` → WS game server (`:4001`)
- `Dockerfile.agent` → agent-runtime (`:4002`)
- `Dockerfile.dealer` → dealer (`:4003`)
- `Dockerfile.verifier` → replay-verifier (`:4004`)
- `Dockerfile.indexer` → chain indexer health (`:4010`)
- `Dockerfile.worker` → settlement-worker (`:4011`)

**Game-server multi-replica:** set `REDIS_URL` so table leases prevent two replicas from owning the same table (WP-080). Without Redis, single-replica only.

On those hosts set `DATABASE_URL`, `SESSION_SECRET`, `WEB_ORIGIN` / `WEB_ORIGINS` to your Vercel URL, `COOKIE_SAMESITE=none`, `COOKIE_SECURE=1`, Supabase keys, and SIWE `SIWE_DOMAIN` / `SIWE_URI` matching the Vercel host. Wire internal `DEALER_URL` / `AGENT_RUNTIME_URL` / `REPLAY_VERIFIER_URL` between services.

Then point the Vercel `NEXT_PUBLIC_*` URLs at the public api/game endpoints.

## Architecture

```
apps/web                 Next.js UI (Vercel)
apps/admin               Minimal ops dashboard (Vercel or separate)
services/api             REST (lobby, wallet, SIWE, admin, verify)
services/game-server     Authoritative WS + NLHE loop (+ optional Redis leases)
services/chain-indexer   ArenaVault log indexer — deposit mirror authority
services/settlement-worker  Checkpoint / mock VRF publisher
services/dealer          Dealer commitments
services/replay-verifier Replay attestations
services/agent-runtime   Live Groq table path (cognition/Energy/cadence) + mock
packages/*               Shared types, DB, game rules, ratings
contracts/               Foundry (ArenaVault, settlement hub, …)
design/                  Original Claude Design .dc.html sources
scripts/bootstrap.sh     Fresh-clone bootstrap + readiness
scripts/anvil-custody-smoke.mjs  Anvil deposit flow checklist
```

## CI

GitHub Actions (`.github/workflows/ci.yml`): install, unit tests, typecheck subset, `forge test`, migrations against Postgres 16. Live Anvil E2E remains a manual local step (`pnpm e2e:arena-account`).

## Database note

Direct `db.*.supabase.co` may be IPv6-only. Use the Supabase **pooler** URL (port 6543) in `DATABASE_URL`, or local Docker via `docker compose up -d`.
