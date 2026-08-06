# Mozetto Arena

Autonomous AI poker platform monorepo — demo world (email) and on-chain world (wallet SIWE on Base).

- **NLHE cash** — authoritative TypeScript game server, mock AI profiles, USDC-style ledgers
- **Dual accounts** — Demo and On-chain are separate profiles (sign out to switch worlds)
- **Supabase Postgres** — profiles, tables, hands, events, ledger
- **Base / Base Sepolia** — Arena vault contracts + optional on-chain faucet for testing

## Quick start (local)

```bash
cp .env.example .env.local
# set DATABASE_URL (Supabase pooler), Supabase keys, SESSION_SECRET

pnpm install
pnpm db:migrate

# Core loop (demo + on-chain custody path)
pnpm --filter @mozetto/api dev
pnpm --filter @mozetto/game-server dev
pnpm --filter @mozetto/chain-indexer dev
pnpm --filter @mozetto/dealer dev
pnpm --filter @mozetto/replay-verifier dev
pnpm --filter @mozetto/settlement-worker dev
pnpm --filter @mozetto/agent-runtime dev
pnpm --filter @mozetto/web dev
# optional ops UI
pnpm --filter @mozetto/admin dev
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
| **agent-runtime** | Render / Docker | Mock AI action schema |

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

Minimal ops UI at `apps/admin` (port **3001**). Set `ADMIN_TOKEN` (same value on API and admin app). Log in via `/login?token=…` or `x-admin-token` header. **Production: put MFA/SSO in front of this app.**

```bash
pnpm --filter @mozetto/admin dev
```

Env: `API_URL`, `ADMIN_TOKEN`, optional `WEB_ORIGIN` / `NEXT_PUBLIC_WEB_ORIGIN` for verify links.

### API + game server (not Vercel)

Long-lived Node + WebSockets are required for matchmaking and tables. Use **Render** (`render.yaml`), Railway, Fly, or any Docker host:

- `Dockerfile.api` → REST API
- `Dockerfile.game` → WS game server
- `Dockerfile.indexer` → chain indexer (vault events, session projection)

**Game-server multi-replica:** set `REDIS_URL` so table leases prevent two replicas from owning the same table. Without Redis, single-replica mode is assumed (leases are no-ops).

On those hosts set `DATABASE_URL`, `SESSION_SECRET`, `WEB_ORIGIN` / `WEB_ORIGINS` to your Vercel URL, `COOKIE_SAMESITE=none`, `COOKIE_SECURE=1`, Supabase keys, and SIWE `SIWE_DOMAIN` / `SIWE_URI` matching the Vercel host.

Then point the Vercel `NEXT_PUBLIC_*` URLs at those services.

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
services/agent-runtime   Schema-validated mock AI actions
packages/*               Shared types, DB, game rules, ratings
contracts/               Foundry (ArenaVault, settlement hub, …)
design/                  Original Claude Design .dc.html sources
scripts/anvil-custody-smoke.mjs  Anvil deposit flow checklist
```

## Database note

Direct `db.*.supabase.co` may be IPv6-only. Use the Supabase **pooler** URL (port 6543) in `DATABASE_URL`.
