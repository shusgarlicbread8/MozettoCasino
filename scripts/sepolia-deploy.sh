#!/usr/bin/env bash
# WP-102 — Base Sepolia V3 deploy recipe (dry-run by default).
# Live broadcast requires funded deployer ETH + PRIVATE_KEY + BASE_SEPOLIA_RPC_URL.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

MODE="${1:-dry-run}" # dry-run | broadcast | check

load_env() {
  if [[ -f "$ROOT/.env.local" ]]; then
    set -a
    # shellcheck disable=SC1091
    source "$ROOT/.env.local"
    set +a
  fi
  if [[ -f "$ROOT/.env" ]]; then
    set -a
    # shellcheck disable=SC1091
    source "$ROOT/.env"
    set +a
  fi
  # Accept SEPOLIA_RPC_URL as alias for BASE_SEPOLIA_RPC_URL
  if [[ -z "${BASE_SEPOLIA_RPC_URL:-}" && -n "${SEPOLIA_RPC_URL:-}" ]]; then
    export BASE_SEPOLIA_RPC_URL="$SEPOLIA_RPC_URL"
  fi
}

require_var() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "MISSING: $name" >&2
    return 1
  fi
  echo "OK: $name=<set>"
}

check_env() {
  local ok=0
  echo "== WP-102 Sepolia env check (names only; values not printed) =="
  require_var BASE_SEPOLIA_RPC_URL || ok=1
  require_var PRIVATE_KEY || ok=1
  echo "OPTIONAL: FEE_TREASURY_ADDRESS BASESCAN_API_KEY USE_MOCK_USDC"
  echo "OPTIONAL: SETTLEMENT_HUB_V3_AS_PRIMARY ENABLE_MOCK_VRF"
  echo "OPTIONAL: PROTOCOL_FEE_VAULT_MIN_DELAY PROOF_BATCH_REGISTRY_MIN_DELAY GAME_REGISTRY_MIN_DELAY"
  echo "OPTIONAL: ATTESTOR_1_ADDRESS ATTESTOR_2_ADDRESS ATTESTOR_3_ADDRESS ATTESTOR_MIN_SIGNATURES"
  echo "OPTIONAL (VRF adapter follow-up): VRF_SUBSCRIPTION_ID RANDOMNESS_BEACON_ADDRESS"
  if [[ -n "${PRIVATE_KEY:-}" && -n "${BASE_SEPOLIA_RPC_URL:-}" ]]; then
    local addr bal
    addr="$(cast wallet address --private-key "$PRIVATE_KEY")"
    bal="$(cast balance "$addr" --rpc-url "$BASE_SEPOLIA_RPC_URL" --ether 2>/dev/null || echo unknown)"
    local chain
    chain="$(cast chain-id --rpc-url "$BASE_SEPOLIA_RPC_URL" 2>/dev/null || echo unknown)"
    echo "deployer=$addr"
    echo "balance_eth=$bal"
    echo "chain_id=$chain (expected 84532)"
    if [[ "$chain" != "84532" ]]; then
      echo "WARN: RPC chain id is not Base Sepolia (84532)" >&2
      ok=1
    fi
    # Rough gate: need meaningful testnet ETH for full stack deploy
    if command -v python3 >/dev/null 2>&1 && [[ "$bal" != "unknown" ]]; then
      if python3 -c "import sys; sys.exit(0 if float('$bal') >= 0.05 else 1)"; then
        echo "balance_gate=PASS (>= 0.05 ETH)"
      else
        echo "balance_gate=FAIL (need >= ~0.05 ETH for live broadcast; recipes remain valid)"
        ok=1
      fi
    fi
  fi
  return "$ok"
}

forge_script() {
  local extra=("$@")
  cd "$ROOT/contracts"
  forge script script/DeploySepolia.s.sol:DeploySepolia \
    --rpc-url "$BASE_SEPOLIA_RPC_URL" \
    -vv \
    "${extra[@]}"
}

load_env

case "$MODE" in
  check)
    check_env
    exit $?
    ;;
  dry-run)
    echo "== WP-102 dry-run (no broadcast) =="
    if ! check_env; then
      echo "Env incomplete for on-chain simulation; attempting compile-only build instead."
      cd "$ROOT/contracts"
      forge build --contracts script/DeploySepolia.s.sol
      exit 0
    fi
    # Simulation without --broadcast; may still need gas estimate against RPC.
    forge_script
    echo "Dry-run complete. Manifest is NOT written unless broadcast succeeds."
    echo "Note: forge script without --broadcast does not persist baseSepolia.json from on-chain deploys."
    ;;
  broadcast)
    echo "== WP-102 LIVE broadcast =="
    check_env || {
      echo "Refusing broadcast: env/balance gate failed. Fund deployer or fix RPC/key." >&2
      exit 1
    }
    VERIFY_FLAGS=()
    if [[ -n "${BASESCAN_API_KEY:-}" ]]; then
      VERIFY_FLAGS=(--verify --etherscan-api-key "$BASESCAN_API_KEY")
    else
      echo "WARN: BASESCAN_API_KEY unset — deploying without --verify (use scripts/sepolia-verify.sh later)"
    fi
    export WRITE_CHAIN_MANIFEST=1
    forge_script --broadcast "${VERIFY_FLAGS[@]}"
    echo "Regenerating chain-manifest TypeScript…"
    cd "$ROOT"
    pnpm --filter @mozetto/chain-manifest codegen
    echo "Done. Confirm packages/chain-manifest/deployments/baseSepolia.json has non-null protocol addresses."
    echo "Next: fund Chainlink VRF sub + forge script DeployChainlinkVrfAdapter.s.sol (WP-053)"
    ;;
  *)
    echo "Usage: $0 [check|dry-run|broadcast]" >&2
    exit 2
    ;;
esac
