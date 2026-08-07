#!/usr/bin/env bash
# WP-100 — Full Anvil protocol E2E orchestrator wrapper.
#
# Usage:
#   bash scripts/anvil-e2e-protocol-v3.sh
#   bash scripts/anvil-e2e-protocol-v3.sh --redeploy
#   bash scripts/anvil-e2e-protocol-v3.sh --redeploy --with-api
#   pnpm e2e:protocol-v3
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="${HOME}/.foundry/bin:${PATH}"
cd "$ROOT"

ANVIL_RPC="${ANVIL_RPC_URL:-http://127.0.0.1:8545}"

ensure_anvil() {
  if curl -sf -X POST "$ANVIL_RPC" -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' >/dev/null; then
    echo "Anvil already up @ $ANVIL_RPC"
    return
  fi
  echo "Starting Anvil…"
  nohup anvil --host 127.0.0.1 --port 8545 --chain-id 31337 --block-time 1 \
    >/tmp/mozetto-anvil-wp100.log 2>&1 &
  for _ in $(seq 1 30); do
    if curl -sf -X POST "$ANVIL_RPC" -H 'content-type: application/json' \
      -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' >/dev/null; then
      echo "Anvil ready"
      return
    fi
    sleep 0.3
  done
  echo "ERROR: Anvil failed to start — see /tmp/mozetto-anvil-wp100.log" >&2
  exit 1
}

ensure_anvil
exec node "$ROOT/scripts/anvil-e2e-protocol-v3.mjs" "$@"
