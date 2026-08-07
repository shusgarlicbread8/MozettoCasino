#!/usr/bin/env bash
# WP-106 — True full Anvil golden match lifecycle (zero GAP).
#
# Usage:
#   bash scripts/anvil-e2e-golden.sh --redeploy
#   pnpm e2e:golden:redeploy
#
# Required stack (host processes — compose is Postgres/Redis only):
#   anvil, migrated DATABASE_URL, api, game-server, agent-runtime
# This wrapper ensures Anvil + game-server + agent-runtime with golden env.
# API must already be running (or is started if port 4000 is free).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="${HOME}/.foundry/bin:${PATH}"
cd "$ROOT"

if [[ -f "$ROOT/.env.local" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env.local"
  set +a
fi

# Golden gates — refuse stub roots in this process and child tooling.
export MOZETTO_GOLDEN=1
export REQUIRE_REAL_ROOTS=1
export CANONICAL_SCHEMA_KIND="${CANONICAL_SCHEMA_KIND:-poker_event_v1}"
export HUMAN_PLAY="${HUMAN_PLAY:-0}"
export AGENT_RUNTIME_MODE="${AGENT_RUNTIME_MODE:-mock}"
export AI_CONTROLLER="${AI_CONTROLLER:-agent-runtime}"

ANVIL_RPC="${ANVIL_RPC_URL:-http://127.0.0.1:8545}"
API_URL="${NEXT_PUBLIC_API_URL:-http://localhost:4000}"
GAME_URL="${NEXT_PUBLIC_GAME_HTTP_URL:-http://localhost:4001}"
AGENT_URL="${AGENT_RUNTIME_URL:-http://localhost:4002}"

ensure_anvil() {
  if curl -sf -X POST "$ANVIL_RPC" -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' >/dev/null; then
    echo "Anvil already up @ $ANVIL_RPC"
    return
  fi
  echo "Starting Anvil…"
  nohup anvil --host 127.0.0.1 --port 8545 --chain-id 31337 --block-time 1 \
    >/tmp/mozetto-anvil-wp106.log 2>&1 &
  for _ in $(seq 1 30); do
    if curl -sf -X POST "$ANVIL_RPC" -H 'content-type: application/json' \
      -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' >/dev/null; then
      echo "Anvil ready"
      return
    fi
    sleep 0.3
  done
  echo "ERROR: Anvil failed to start — see /tmp/mozetto-anvil-wp106.log" >&2
  exit 1
}

wait_http() {
  local url="$1" name="$2" attempts="${3:-40}"
  for _ in $(seq 1 "$attempts"); do
    if curl -sf "$url/health" >/dev/null 2>&1; then
      echo "$name healthy @ $url"
      return 0
    fi
    sleep 0.35
  done
  echo "ERROR: $name not healthy @ $url" >&2
  return 1
}

ensure_service() {
  local name="$1" url="$2" filter="$3" log="$4"
  if curl -sf "$url/health" >/dev/null 2>&1; then
    echo "$name already up @ $url"
    return 0
  fi
  echo "Starting $name…"
  nohup pnpm --filter "$filter" start >"$log" 2>&1 &
  if ! wait_http "$url" "$name" 50; then
    echo "---- $log (tail) ----" >&2
    tail -40 "$log" >&2 || true
    exit 1
  fi
}

ensure_anvil
ensure_service "api" "$API_URL" "@mozetto/api" "/tmp/mozetto-api-wp106.log"
ensure_service "game-server" "$GAME_URL" "@mozetto/game-server" "/tmp/mozetto-game-wp106.log"
ensure_service "agent-runtime" "$AGENT_URL" "@mozetto/agent-runtime" "/tmp/mozetto-agent-wp106.log"

# Confirm golden schema flags on game-server (restart note if stale process).
GAME_HEALTH="$(curl -sf "$GAME_URL/health" || true)"
if ! echo "$GAME_HEALTH" | grep -q 'poker_event_v1'; then
  if ! echo "$GAME_HEALTH" | grep -q '"requireRealRoots":true'; then
    echo "WARN: game-server missing poker_event_v1 / requireRealRoots — restarting with golden env…"
    # Best-effort restart of game-server only
    pkill -f 'services/game-server.*tsx.*src/index' 2>/dev/null || true
    sleep 0.8
    nohup env MOZETTO_GOLDEN=1 REQUIRE_REAL_ROOTS=1 CANONICAL_SCHEMA_KIND=poker_event_v1 HUMAN_PLAY=0 \
      pnpm --filter @mozetto/game-server start >/tmp/mozetto-game-wp106.log 2>&1 &
    wait_http "$GAME_URL" "game-server" 50 || exit 1
  fi
fi

echo "Golden stack ready (MOZETTO_GOLDEN=1 REQUIRE_REAL_ROOTS=1 CANONICAL_SCHEMA_KIND=$CANONICAL_SCHEMA_KIND)"
exec node --import tsx "$ROOT/scripts/anvil-e2e-golden.mjs" "$@"
