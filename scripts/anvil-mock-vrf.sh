#!/usr/bin/env bash
# WP-052 — Orchestrate deterministic mock VRF on Anvil.
#
# Usage:
#   bash scripts/anvil-mock-vrf.sh              # forge script (fixture roots)
#   bash scripts/anvil-mock-vrf.sh --node       # node E2E (viem)
#   bash scripts/anvil-mock-vrf.sh --node --with-deck
#   bash scripts/anvil-mock-vrf.sh --both
#   bash scripts/anvil-mock-vrf.sh --redeploy   # DeployLocal first, then run
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="${HOME}/.foundry/bin:${PATH}"
cd "$ROOT"

ANVIL_RPC="${ANVIL_RPC_URL:-http://127.0.0.1:8545}"
MODE="forge"
WITH_DECK=0
REDEPLOY=0
BOTH=0

for arg in "$@"; do
  case "$arg" in
    --node) MODE="node" ;;
    --both) BOTH=1 ;;
    --with-deck) WITH_DECK=1 ;;
    --redeploy) REDEPLOY=1 ;;
    -h|--help)
      sed -n '2,12p' "$0"
      exit 0
      ;;
  esac
done

ensure_anvil() {
  if curl -sf -X POST "$ANVIL_RPC" -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' >/dev/null; then
    echo "Anvil already up @ $ANVIL_RPC"
    return
  fi
  echo "Starting Anvil…"
  ANVIL_ARGS=(--host 127.0.0.1 --port 8545 --chain-id 31337)
  if [[ -n "${ANVIL_BLOCK_TIME:-}" ]]; then ANVIL_ARGS+=(--block-time "$ANVIL_BLOCK_TIME"); fi
  nohup anvil "${ANVIL_ARGS[@]}" >/tmp/mozetto-anvil-wp052.log 2>&1 &
  for _ in $(seq 1 30); do
    if curl -sf -X POST "$ANVIL_RPC" -H 'content-type: application/json' \
      -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' >/dev/null; then
      echo "Anvil ready"
      return
    fi
    sleep 0.3
  done
  echo "ERROR: Anvil failed to start — see /tmp/mozetto-anvil-wp052.log" >&2
  exit 1
}

ensure_anvil

if [[ "$REDEPLOY" == "1" ]]; then
  echo "DeployLocal (mock VRF beacon on)…"
  (cd contracts && env -u USDC_ADDRESS forge script script/DeployLocal.s.sol \
    --rpc-url "$ANVIL_RPC" --broadcast -vv)
  pnpm --filter @mozetto/chain-manifest codegen
fi

# Prefer manifest beacon when present
BEACON=""
if [[ -f packages/chain-manifest/deployments/anvil.json ]]; then
  BEACON="$(node -e 'const m=require("./packages/chain-manifest/deployments/anvil.json"); process.stdout.write(m.randomnessBeacon||"")')"
fi
if [[ -n "$BEACON" && "$BEACON" != "null" ]]; then
  export RANDOMNESS_BEACON_ADDRESS="$BEACON"
  echo "RANDOMNESS_BEACON_ADDRESS=$BEACON"
fi

run_forge() {
  echo ""
  echo "=== forge MockVrfAnvil.s.sol ==="
  # Fresh session salt when targeting an already-used DeployLocal beacon
  export MOCK_VRF_SESSION_SALT="${MOCK_VRF_SESSION_SALT:-wp052-session-$(date +%s)}"
  (cd contracts && forge script script/MockVrfAnvil.s.sol --rpc-url "$ANVIL_RPC" --broadcast -vv)
}

run_node() {
  echo ""
  echo "=== node anvil-mock-vrf-beacon.mjs ==="
  export MOCK_VRF_SESSION_SALT="${MOCK_VRF_SESSION_SALT:-wp052-node-$(date +%s)}"
  EXTRA=()
  if [[ -z "${RANDOMNESS_BEACON_ADDRESS:-}" ]]; then
    EXTRA+=(--deploy-beacon)
  fi
  if [[ "$WITH_DECK" == "1" ]]; then
    EXTRA+=(--with-deck)
  fi
  # tsx lives under @mozetto/dealer-deck; run from that package so --import tsx resolves.
  (
    cd packages/dealer-deck
    node --import tsx ../../scripts/anvil-mock-vrf-beacon.mjs "${EXTRA[@]}"
  )
}

if [[ "$BOTH" == "1" ]]; then
  run_forge
  run_node
elif [[ "$MODE" == "node" ]]; then
  run_node
else
  run_forge
fi

echo ""
echo "WP-052 mock VRF path OK. See docs/WP-052_MOCK_VRF_ANVIL.md"
