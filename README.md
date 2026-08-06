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

pnpm --filter @mozetto/agent-runtime dev
pnpm --filter @mozetto/api dev
pnpm --filter @mozetto/game-server dev
pnpm --filter @mozetto/web dev
```

Open http://localhost:3000 → **Play Demo** or **Enter On-chain**.

## Deploy

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

### API + game server (not Vercel)

Long-lived Node + WebSockets are required for matchmaking and tables. Use **Render** (`render.yaml`), Railway, Fly, or any Docker host:

- `Dockerfile.api` → REST API
- `Dockerfile.game` → WS game server

On those hosts set `DATABASE_URL`, `SESSION_SECRET`, `WEB_ORIGIN` / `WEB_ORIGINS` to your Vercel URL, `COOKIE_SAMESITE=none`, `COOKIE_SECURE=1`, Supabase keys, and SIWE `SIWE_DOMAIN` / `SIWE_URI` matching the Vercel host.

Then point the Vercel `NEXT_PUBLIC_*` URLs at those services.

## Architecture

```
apps/web                 Next.js UI (Vercel)
services/api             REST (lobby, wallet, SIWE, faucet)
services/game-server     Authoritative WS + NLHE loop
services/agent-runtime   Schema-validated mock AI actions
services/settlement-worker  Checkpoint / mock VRF publisher
packages/*               Shared types, DB, game rules, ratings
contracts/               Foundry (ArenaVault, settlement hub, …)
design/                  Original Claude Design .dc.html sources
```

## Database note

Direct `db.*.supabase.co` may be IPv6-only. Use the Supabase **pooler** URL (port 6543) in `DATABASE_URL`.
