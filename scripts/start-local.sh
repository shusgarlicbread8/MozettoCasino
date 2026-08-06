#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$HOME/.foundry/bin:$PATH"
cd "$ROOT"
set -a; source .env.local; set +a

if ! curl -sf -X POST http://127.0.0.1:8545 -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' >/dev/null; then
  echo "Starting Anvil…"
  nohup anvil --host 127.0.0.1 --port 8545 --chain-id 31337 --block-time 1 >/tmp/mozetto-anvil.log 2>&1 &
  sleep 2
  # Do not pass USDC_ADDRESS — DeployLocal must mint fresh MockUSDC on a new chain.
  (cd contracts && env -u USDC_ADDRESS forge script script/DeployLocal.s.sol --rpc-url http://127.0.0.1:8545 --broadcast)
  pnpm --filter @mozetto/chain-manifest codegen
  echo "Re-source .env.local after updating addresses from deployments/anvil.json"
fi

for p in 3000 3001 4000 4001 4002 4003 4004; do kill $(lsof -t -iTCP:$p -sTCP:LISTEN) 2>/dev/null || true; done
sleep 1

pnpm --filter @mozetto/api start:local >/tmp/mozetto-api.log 2>&1 &
pnpm --filter @mozetto/game-server start:local >/tmp/mozetto-game.log 2>&1 &
pnpm --filter @mozetto/agent-runtime start >/tmp/mozetto-agent.log 2>&1 &
(set -a; source .env.local; set +a; pnpm --filter @mozetto/dealer start) >/tmp/mozetto-dealer.log 2>&1 &
(set -a; source .env.local; set +a; pnpm --filter @mozetto/replay-verifier start) >/tmp/mozetto-replay.log 2>&1 &
(set -a; source .env.local; set +a; pnpm --filter @mozetto/chain-indexer start) >/tmp/mozetto-indexer.log 2>&1 &
(set -a; source .env.local; set +a; pnpm --filter @mozetto/settlement-worker start) >/tmp/mozetto-settlement.log 2>&1 &
pnpm --filter @mozetto/web dev >/tmp/mozetto-web.log 2>&1 &
pnpm --filter @mozetto/admin dev >/tmp/mozetto-admin.log 2>&1 &

sleep 4
echo "Web     http://localhost:3000"
echo "Admin   http://localhost:3001/login?token=$(grep ^ADMIN_TOKEN= .env.local | cut -d= -f2)"
echo "API     http://localhost:4000/health"
echo "Anvil   http://127.0.0.1:8545  (chain 31337)"
echo "Logs in /tmp/mozetto-*.log"
