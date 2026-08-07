#!/usr/bin/env bash
# Clean local Anvil (+ optional Docker Postgres wipe) and redeploy V2 stack.
#
# Usage:
#   ./scripts/reset-local.sh              # kill Anvil, start fresh, DeployLocal, codegen, sync .env.local
#   ./scripts/reset-local.sh --db         # also wipe docker volume mozetto_pg_data and re-migrate
#   ./scripts/reset-local.sh --db-only    # wipe/recreate docker postgres only (no Anvil)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export PATH="${HOME}/.foundry/bin:${PATH}"

DO_ANVIL=1
DO_DB=0
for arg in "$@"; do
  case "$arg" in
    --db) DO_DB=1 ;;
    --db-only) DO_ANVIL=0; DO_DB=1 ;;
    -h|--help)
      sed -n '2,12p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown arg: $arg" >&2
      exit 1
      ;;
  esac
done

if [[ ! -f .env.local ]]; then
  echo "ERROR: .env.local missing. Run: pnpm bootstrap  (or cp .env.example .env.local)" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
source .env.local
set +a

ANVIL_RPC="${ANVIL_RPC_URL:-http://127.0.0.1:8545}"

if [[ "$DO_DB" == "1" ]]; then
  if ! command -v docker >/dev/null 2>&1; then
    echo "ERROR: --db requires docker" >&2
    exit 1
  fi
  echo "Resetting Docker Postgres volume…"
  docker compose stop postgres >/dev/null 2>&1 || true
  docker compose rm -f postgres >/dev/null 2>&1 || true
  docker volume rm mozettocasino_mozetto_pg_data 2>/dev/null \
    || docker volume rm mozetto_pg_data 2>/dev/null \
    || true
  # Compose project name may prefix the volume; remove matching volumes.
  docker volume ls -q | grep -E 'mozetto_pg_data$' | while read -r vol; do
    docker volume rm "$vol" 2>/dev/null || true
  done
  docker compose up -d postgres
  echo "Waiting for Postgres…"
  for _ in $(seq 1 30); do
    if docker compose exec -T postgres pg_isready -U mozetto -d mozetto >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
  # Prefer local docker URL for migrate after wipe
  export DATABASE_URL="${DATABASE_URL:-postgresql://mozetto:mozetto@127.0.0.1:5432/mozetto}"
  if [[ "$DATABASE_URL" != *"127.0.0.1"* && "$DATABASE_URL" != *"localhost"* ]]; then
    echo "NOTE: DATABASE_URL points at a remote host. After --db wipe of docker volume,"
    echo "      set DATABASE_URL=postgresql://mozetto:mozetto@127.0.0.1:5432/mozetto to migrate the local DB,"
    echo "      or omit --db and migrate your remote Supabase instead."
  fi
  pnpm db:migrate
fi

if [[ "$DO_ANVIL" != "1" ]]; then
  echo "DB reset complete (--db-only)."
  exit 0
fi

echo "Stopping Anvil on :8545 (if any)…"
if command -v lsof >/dev/null 2>&1; then
  kill "$(lsof -t -iTCP:8545 -sTCP:LISTEN)" 2>/dev/null || true
fi
pkill -f '[a]nvil --host 127.0.0.1 --port 8545' 2>/dev/null || true
sleep 1

echo "Starting fresh Anvil (chain 31337)…"
nohup anvil --host 127.0.0.1 --port 8545 --chain-id 31337 --block-time 1 >/tmp/mozetto-anvil.log 2>&1 &
sleep 2

if ! curl -sf -X POST "$ANVIL_RPC" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' >/dev/null; then
  echo "ERROR: Anvil failed to start — see /tmp/mozetto-anvil.log" >&2
  exit 1
fi

echo "Deploying MockUSDC + ArenaVault V2 stack…"
(cd contracts && env -u USDC_ADDRESS forge script script/DeployLocal.s.sol --rpc-url "$ANVIL_RPC" --broadcast -vv)
pnpm --filter @mozetto/chain-manifest codegen

# Sync addresses into .env.local (same as start-local.sh)
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
NODE

USDC="$(node -e 'console.log(JSON.parse(require("fs").readFileSync("packages/chain-manifest/deployments/anvil.json","utf8")).usdc)')"
SYM="$(cast call "$USDC" "symbol()(string)" --rpc-url "$ANVIL_RPC" | tr -d '"')"
DEC="$(cast call "$USDC" "decimals()(uint8)" --rpc-url "$ANVIL_RPC")"
echo "Token check: symbol=$SYM decimals=$DEC"
if [[ "$SYM" != "mUSDC" || "$DEC" != "6" ]]; then
  echo "ERROR: expected mUSDC / 6 decimals" >&2
  exit 1
fi

echo
echo "Reset complete. Run: ./scripts/readiness-report.sh"
echo "Tip: ./scripts/start-local.sh   # boot API/game/web (migrates DB)"
