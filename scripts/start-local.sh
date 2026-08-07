#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$HOME/.foundry/bin:$PATH"
cd "$ROOT"
set -a; source .env.local; set +a

ANVIL_RPC="${ANVIL_RPC_URL:-http://127.0.0.1:8545}"
REDEPLOY=0
if [[ "${1:-}" == "--redeploy" ]]; then REDEPLOY=1; fi

if ! curl -sf -X POST "$ANVIL_RPC" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' >/dev/null; then
  echo "Starting Anvil…"
  nohup anvil --host 127.0.0.1 --port 8545 --chain-id 31337 --block-time 1 >/tmp/mozetto-anvil.log 2>&1 &
  sleep 2
  REDEPLOY=1
fi

if [[ "$REDEPLOY" == "1" ]]; then
  echo "Deploying MockUSDC + ArenaVault stack to Anvil…"
  # Never pass a stale USDC_ADDRESS — DeployLocal always mints fresh mUSDC.
  (cd contracts && env -u USDC_ADDRESS forge script script/DeployLocal.s.sol --rpc-url "$ANVIL_RPC" --broadcast -vv)
  pnpm --filter @mozetto/chain-manifest codegen

  # Sync addresses from manifest into .env.local
  node <<'NODE'
const fs = require("fs");
const path = require("path");
const root = process.cwd();
const anvil = JSON.parse(fs.readFileSync(path.join(root, "packages/chain-manifest/deployments/anvil.json"), "utf8"));
const envPath = path.join(root, ".env.local");
let env = fs.readFileSync(envPath, "utf8");
const set = (key, val) => {
  const re = new RegExp(`^${key}=.*$`, "m");
  if (re.test(env)) env = env.replace(re, `${key}=${val}`);
  else env += `\n${key}=${val}\n`;
};
set("USDC_ADDRESS", anvil.usdc);
set("NEXT_PUBLIC_USDC_ADDRESS", anvil.usdc);
set("ARENA_VAULT_ADDRESS", anvil.arenaVault);
set("NEXT_PUBLIC_ARENA_VAULT_ADDRESS", anvil.arenaVault);
if (anvil.arenaAccountFactory) {
  set("ARENA_ACCOUNT_FACTORY_ADDRESS", anvil.arenaAccountFactory);
  set("NEXT_PUBLIC_ARENA_ACCOUNT_FACTORY_ADDRESS", anvil.arenaAccountFactory);
}
if (anvil.arenaAccountImplementation) {
  set("ARENA_ACCOUNT_IMPLEMENTATION_ADDRESS", anvil.arenaAccountImplementation);
}
set("TABLE_REGISTRY_ADDRESS", anvil.tableRegistry);
set("SETTLEMENT_HUB_ADDRESS", anvil.settlementHub);
set("CHECKPOINT_REGISTRY_ADDRESS", anvil.checkpointRegistry);
set("RANDOMNESS_COORDINATOR_ADDRESS", anvil.randomnessCoordinator);
set("FEE_TREASURY_ADDRESS", anvil.feeTreasury);
set("DEPLOYMENT_BLOCK", String(anvil.deploymentBlock));
set("MOZETTO_CHAIN_ENV", "anvil");
set("NEXT_PUBLIC_CHAIN_ENV", "anvil");
fs.writeFileSync(envPath, env);
console.log("Synced .env.local from anvil.json");
console.log("  mUSDC", anvil.usdc);
console.log("  vault", anvil.arenaVault);
console.log("  factory", anvil.arenaAccountFactory || "(none)");
NODE

  # Validate token metadata on-chain
  USDC=$(node -e 'console.log(JSON.parse(require("fs").readFileSync("packages/chain-manifest/deployments/anvil.json","utf8")).usdc)')
  SYM=$(cast call "$USDC" "symbol()(string)" --rpc-url "$ANVIL_RPC" | tr -d '"')
  DEC=$(cast call "$USDC" "decimals()(uint8)" --rpc-url "$ANVIL_RPC")
  echo "Token check: symbol=$SYM decimals=$DEC"
  if [[ "$SYM" != "mUSDC" || "$DEC" != "6" ]]; then
    echo "ERROR: expected mUSDC / 6 decimals" >&2
    exit 1
  fi
fi

# Re-source after possible sync
set -a; source .env.local; set +a
pnpm db:migrate

for p in 3000 3001 4000 4001 4002 4003 4004; do
  kill $(lsof -t -iTCP:$p -sTCP:LISTEN) 2>/dev/null || true
done
sleep 1

# nohup so services survive when this script's shell exits (agent/CI runners).
nohup pnpm --filter @mozetto/api start:local >/tmp/mozetto-api.log 2>&1 &
nohup pnpm --filter @mozetto/game-server start:local >/tmp/mozetto-game.log 2>&1 &
nohup pnpm --filter @mozetto/agent-runtime start >/tmp/mozetto-agent.log 2>&1 &
nohup bash -c 'set -a; source .env.local; set +a; pnpm --filter @mozetto/dealer start' >/tmp/mozetto-dealer.log 2>&1 &
nohup bash -c 'set -a; source .env.local; set +a; pnpm --filter @mozetto/replay-verifier start' >/tmp/mozetto-replay.log 2>&1 &
nohup bash -c 'set -a; source .env.local; set +a; pnpm --filter @mozetto/chain-indexer start' >/tmp/mozetto-indexer.log 2>&1 &
nohup bash -c 'set -a; source .env.local; set +a; pnpm --filter @mozetto/settlement-worker start' >/tmp/mozetto-settlement.log 2>&1 &
nohup pnpm --filter @mozetto/web dev >/tmp/mozetto-web.log 2>&1 &
nohup pnpm --filter @mozetto/admin dev >/tmp/mozetto-admin.log 2>&1 &
disown -a 2>/dev/null || true

sleep 4
if ! curl -sf http://127.0.0.1:4000/health >/dev/null; then
  echo "WARNING: API health check failed — see /tmp/mozetto-api.log" >&2
fi
echo "Web     http://localhost:3000"
echo "Admin   http://localhost:3001/login?token=$(grep ^ADMIN_TOKEN= .env.local | cut -d= -f2)"
echo "API     http://localhost:4000/health"
echo "Anvil   http://127.0.0.1:8545  (chain 31337)"
echo "mUSDC   $(grep ^NEXT_PUBLIC_USDC_ADDRESS= .env.local | cut -d= -f2)"
echo "Vault   $(grep ^NEXT_PUBLIC_ARENA_VAULT_ADDRESS= .env.local | cut -d= -f2)"
echo "Logs in /tmp/mozetto-*.log"
echo "Tip: ./scripts/start-local.sh --redeploy  # force fresh MockUSDC + vault"
