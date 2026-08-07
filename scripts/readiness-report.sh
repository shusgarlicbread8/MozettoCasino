#!/usr/bin/env bash
# Print local stack readiness (ports, health, chain id, key addresses).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export PATH="${HOME}/.foundry/bin:${PATH}"

ENV_FILE="${ENV_FILE:-.env.local}"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

ANVIL_RPC="${ANVIL_RPC_URL:-http://127.0.0.1:8545}"
MANIFEST="$ROOT/packages/chain-manifest/deployments/anvil.json"

check_port() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
  else
    (echo >/dev/tcp/127.0.0.1/"$port") >/dev/null 2>&1
  fi
}

http_ok() {
  curl -sf --max-time 3 "$1" >/dev/null 2>&1
}

status_line() {
  local label="$1" ok="$2" detail="$3"
  if [[ "$ok" == "1" ]]; then
    printf '  %-22s %-6s %s\n' "$label" "OK" "$detail"
  else
    printf '  %-22s %-6s %s\n' "$label" "DOWN" "$detail"
  fi
}

echo "=== Mozetto readiness report ==="
echo "Time: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo

echo "-- Ports / health --"
if check_port 8545; then
  CHAIN_HEX="$(curl -sf -X POST "$ANVIL_RPC" -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' 2>/dev/null \
    | sed -n 's/.*"result":"\([^"]*\)".*/\1/p' || true)"
  CHAIN_DEC=""
  if [[ -n "$CHAIN_HEX" ]]; then
    CHAIN_DEC="$((CHAIN_HEX))"
  fi
  status_line "Anvil :8545" 1 "chainId=${CHAIN_DEC:-unknown} rpc=$ANVIL_RPC"
else
  status_line "Anvil :8545" 0 "expected chain 31337"
fi

if http_ok "http://127.0.0.1:4000/health"; then
  status_line "API :4000" 1 "http://127.0.0.1:4000/health"
else
  status_line "API :4000" 0 "/health"
fi

if http_ok "http://127.0.0.1:4001/health" || check_port 4001; then
  status_line "Game :4001" 1 "http://127.0.0.1:4001"
else
  status_line "Game :4001" 0 "WS/HTTP game-server"
fi

for spec in "Agent:4002" "Dealer:4003" "Replay:4004" "Web:3000" "Admin:3001"; do
  name="${spec%%:*}"
  port="${spec##*:}"
  if check_port "$port"; then
    status_line "$name :$port" 1 "listening"
  else
    status_line "$name :$port" 0 "not listening"
  fi
done

if check_port 5432; then
  status_line "Postgres :5432" 1 "listening (docker or local)"
else
  status_line "Postgres :5432" 0 "optional if using remote Supabase"
fi
if check_port 6379; then
  status_line "Redis :6379" 1 "listening"
else
  status_line "Redis :6379" 0 "optional (single-replica leases)"
fi

echo
echo "-- Env --"
if [[ -n "${DATABASE_URL:-}" ]]; then
  # Redact credentials
  REDACTED="$(echo "$DATABASE_URL" | sed -E 's#://([^:/@]+):([^@/]+)@#://\1:***@#')"
  echo "  DATABASE_URL          set ($REDACTED)"
else
  echo "  DATABASE_URL          MISSING (required for migrate / API / E2E)"
fi
echo "  MOZETTO_CHAIN_ENV     ${MOZETTO_CHAIN_ENV:-unset}"
echo "  NEXT_PUBLIC_CHAIN_ENV ${NEXT_PUBLIC_CHAIN_ENV:-unset}"

echo
echo "-- Chain manifest (anvil.json) --"
if [[ -f "$MANIFEST" ]]; then
  node <<'NODE'
const fs = require("fs");
const p = "packages/chain-manifest/deployments/anvil.json";
const j = JSON.parse(fs.readFileSync(p, "utf8"));
const keys = [
  ["usdc", "mUSDC"],
  ["arenaVault", "ArenaVault"],
  ["arenaAccountFactory", "ArenaAccountFactory"],
  ["arenaAccountImplementation", "ArenaAccountImpl"],
  ["tableRegistry", "TableRegistry"],
  ["settlementHub", "SettlementHub"],
  ["checkpointRegistry", "CheckpointRegistry"],
  ["randomnessCoordinator", "RandomnessCoordinator"],
  ["feeTreasury", "FeeTreasury"],
];
for (const [k, label] of keys) {
  console.log(`  ${label.padEnd(22)} ${j[k] || "(null)"}`);
}
console.log(`  ${"deploymentBlock".padEnd(22)} ${j.deploymentBlock ?? "(null)"}`);
console.log(`  ${"chainId".padEnd(22)} ${j.chainId ?? 31337}`);
NODE
else
  echo "  MISSING — run: ./scripts/reset-local.sh  (or bootstrap --reset)"
fi

echo
echo "-- Suggested next steps --"
echo "  pnpm e2e:arena-account   # needs Anvil + API + game-server + DATABASE_URL"
echo "  pnpm smoke:custody:run   # Anvil custody smoke"
echo "  Logs: /tmp/mozetto-*.log"
echo "=== end readiness report ==="
