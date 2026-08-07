#!/usr/bin/env bash
# WP-105 — Base mainnet deploy wrapper.
# Default: refuse broadcast. Live tx only after Plan 14 gates + final approval.
# Does not invent addresses. Never uses Anvil keys as mainnet truth.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

MODE="${1:-check}" # check | dry-run | broadcast

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
  echo "== WP-105 mainnet env check (names only; values not printed) =="
  require_var BASE_RPC_URL || ok=1
  require_var PRIVATE_KEY || ok=1
  echo "OPTIONAL: BASESCAN_API_KEY FEE_TREASURY_ADDRESS"
  echo "REQUIRED AT GO-LIVE: PROTOCOL_SAFE_ADDRESS TREASURY_SAFE_ADDRESS"
  echo "OPTIONAL: TIMELOCK_CONTROLLER_ADDRESS"
  echo "FORBIDDEN: USE_MOCK_USDC=1 on mainnet"
  echo "GATE: MOZETTO_MAINNET_FINAL_GATE_APPROVED must be 1 for broadcast"
  if [[ "${USE_MOCK_USDC:-0}" == "1" ]]; then
    echo "FAIL: USE_MOCK_USDC=1 forbidden on Base mainnet" >&2
    ok=1
  fi
  if [[ -n "${PRIVATE_KEY:-}" && -n "${BASE_RPC_URL:-}" ]]; then
    local addr bal chain
    addr="$(cast wallet address --private-key "$PRIVATE_KEY" 2>/dev/null || echo unknown)"
    bal="$(cast balance "$addr" --rpc-url "$BASE_RPC_URL" --ether 2>/dev/null || echo unknown)"
    chain="$(cast chain-id --rpc-url "$BASE_RPC_URL" 2>/dev/null || echo unknown)"
    echo "deployer=$addr"
    echo "balance_eth=$bal"
    echo "chain_id=$chain (expected 8453)"
    if [[ "$chain" != "8453" ]]; then
      echo "WARN: RPC chain id is not Base mainnet (8453)" >&2
      ok=1
    fi
    # Refuse well-known Anvil default #0 as mainnet deployer truth
    local addr_lc
    addr_lc="$(printf '%s' "$addr" | tr '[:upper:]' '[:lower:]')"
    if [[ "$addr_lc" == "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266" ]]; then
      echo "FAIL: Anvil default key #0 is forbidden as mainnet deployer" >&2
      ok=1
    fi
  fi
  return "$ok"
}

refuse_broadcast() {
  echo ""
  echo "REFUSING mainnet broadcast."
  echo "WP-105 recipes/gates only — live restricted mainnet remains BLOCKED until:"
  echo "  1) pnpm mainnet:gate exits 0 (all GATES.json required=true including finalGateApproval)"
  echo "  2) MOZETTO_MAINNET_FINAL_GATE_APPROVED=1"
  echo "  3) DeployMainnet cutover from DeploySepolia pattern is reviewed"
  echo "See docs/WP-105_RESTRICTED_MAINNET.md"
}

load_env

case "$MODE" in
  check)
    set +e
    check_env
    ENV_RC=$?
    set -e
    echo ""
    set +e
    bash "$ROOT/scripts/mainnet/gate.sh" entry
    GATE_RC=$?
    set -e
    if [[ "$ENV_RC" -ne 0 || "$GATE_RC" -ne 0 ]]; then
      refuse_broadcast
      exit 1
    fi
    echo "Env + gates green — still require explicit ops run with documented approval for broadcast."
    exit 0
    ;;
  dry-run)
    echo "== WP-105 dry-run (no broadcast; stub guards) =="
    set +e
    check_env
    set -e
    cd "$ROOT/contracts"
    # Compile stub — live broadcast still blocked by recipe + stub revert
    forge build --contracts script/DeployMainnet.s.sol
    echo "Dry-run compile OK. Manifest is NOT written. Live broadcast still blocked by recipe."
    refuse_broadcast
    exit 1
    ;;
  broadcast)
    echo "== WP-105 LIVE broadcast request =="
    set +e
    bash "$ROOT/scripts/mainnet/gate.sh" entry
    GATE_RC=$?
    set -e
    if [[ "$GATE_RC" -ne 0 ]]; then
      refuse_broadcast
      exit 1
    fi
    if [[ "${MOZETTO_MAINNET_FINAL_GATE_APPROVED:-0}" != "1" ]]; then
      echo "FAIL: MOZETTO_MAINNET_FINAL_GATE_APPROVED is not 1" >&2
      refuse_broadcast
      exit 1
    fi
    check_env || {
      echo "Refusing broadcast: env gate failed." >&2
      exit 1
    }
    # Hard stop: stub does not enable WRITE_CHAIN_MANIFEST broadcast path yet.
    echo "FAIL: DeployMainnet is a guarded stub — full V3 cutover not enabled in WP-105 recipes." >&2
    refuse_broadcast
    exit 1
    ;;
  *)
    echo "Usage: $0 [check|dry-run|broadcast]" >&2
    exit 2
    ;;
esac
