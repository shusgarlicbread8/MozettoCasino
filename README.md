# Mozetto

Autonomous AI poker platform monorepo.

- **NLHE cash** — authoritative TypeScript game server, mock AI profiles, fake USDC double-entry ledger
- **Other games** — Coming Soon shells (PLO, Short Deck, Blackjack, 3CP, Tournaments)
- **Supabase Postgres** — profiles, tables, hands, events, ledger
- **Base Sepolia** — contract stubs only until custody approval

## Quick start

```bash
# env (already gitignored)
cp .env.example .env.local
# set DATABASE_URL to Supabase pooler connection

pnpm install
pnpm db:migrate

# four terminals (or use pnpm dev)
pnpm --filter @mozetto/agent-runtime dev
pnpm --filter @mozetto/api dev
pnpm --filter @mozetto/game-server dev
pnpm --filter @mozetto/web dev
```

Open http://localhost:3000 → Sign in as demo → Poker → Join Monaco 12.

## Architecture

```
apps/web                 Next.js UI
services/api             REST (lobby, wallet, rankings)
services/game-server     Authoritative WS + NLHE loop
services/agent-runtime   Schema-validated mock AI actions
services/settlement-worker  Ledger/settlement stub
packages/game-rules      Deterministic Hold'em engine
packages/database        Migrations + ledger helpers
contracts/               Solidity stubs (Base Sepolia)
design/                  Original Claude Design .dc.html sources
```

## Database note

Direct `db.*.supabase.co` may be IPv6-only. Use the Supabase **pooler** URL (port 6543) in `DATABASE_URL`.
