#!/usr/bin/env bash
# WP-102 — Base Sepolia V3 deploy recipe (dry-run by default).
# Live broadcast requires funded deployer ETH + PRIVATE_KEY + BASE_SEPOLIA_RPC_URL.
# Well-known Anvil (#0–#9) keys are FORBIDDEN for Base Sepolia check/broadcast.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

MODE="${1:-dry-run}" # dry-run | broadcast | check

# Foundry Anvil default accounts #0–#9 (address lowercase). Never broadcast with these on 84532.
ANVIL_ADDRS=(
  "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266" # #0
  "0x70997970c51812dc3a010c7d01b50e0d17dc79c8" # #1
  "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc" # #2
  "0x90f79bf6eb2c4f870365e785982e1f101e93b906" # #3
  "0x15d34aaf54267db7d7c367839aaf71a00a2c6a65" # #4
  "0x9965507d1a55bcc2695c58ba16fb37d819b0a4dc" # #5
  "0x976ea74026e726554db657fa54763abd0c3a0aa9" # #6
  "0x14dc79964da2c08b23698b3d3cc7ca32193d9955" # #7
  "0x23618e81e3f5cdf7f54c3d65f7fbc0abf5b21e8f" # #8
  "0xa0ee7a142d267c1f36714e4a8f75612f20a79720" # #9
)

# Matching Anvil default private keys (lowercase, with 0x). Checked so a mis-set key fails even if cast fails.
ANVIL_PRIVATE_KEYS=(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6"
  "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a"
  "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba"
  "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e"
  "0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356"
  "0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97"
  "0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6"
)

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

# Returns 0 if PRIVATE_KEY is a well-known Anvil default (forbidden on live Sepolia).
is_anvil_private_key() {
  local pk_lc
  pk_lc="$(printf '%s' "${PRIVATE_KEY:-}" | tr '[:upper:]' '[:lower:]')"
  # Normalize missing 0x
  if [[ -n "$pk_lc" && "$pk_lc" != 0x* ]]; then
    pk_lc="0x$pk_lc"
  fi
  local known
  for known in "${ANVIL_PRIVATE_KEYS[@]}"; do
    if [[ "$pk_lc" == "$known" ]]; then
      return 0
    fi
  done
  return 1
}

# Returns 0 if address is Anvil #0–#9.
is_anvil_address() {
  local addr_lc="$1"
  local known
  for known in "${ANVIL_ADDRS[@]}"; do
    if [[ "$addr_lc" == "$known" ]]; then
      return 0
    fi
  done
  return 1
}

refuse_anvil_deployer() {
  echo "FAIL: Anvil default private key / address is FORBIDDEN for Base Sepolia live deploy." >&2
  echo "      Replace PRIVATE_KEY with a funded non-Anvil ops deployer (≥0.05 ETH on chain 84532)." >&2
  echo "      See docs/WAVE_13_STAGE_A_GO_LIVE.md" >&2
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
  echo "FORBIDDEN: Anvil default PRIVATE_KEY (#0–#9) on Base Sepolia broadcast"

  if [[ -n "${PRIVATE_KEY:-}" ]]; then
    if is_anvil_private_key; then
      refuse_anvil_deployer
      echo "anvil_key_gate=FAIL (well-known Anvil private key)"
      ok=1
    else
      echo "anvil_key_gate=PASS (PRIVATE_KEY is not an Anvil default)"
    fi
  fi

  if [[ -n "${PRIVATE_KEY:-}" && -n "${BASE_SEPOLIA_RPC_URL:-}" ]]; then
    local addr bal chain addr_lc
    addr="$(cast wallet address --private-key "$PRIVATE_KEY" 2>/dev/null || echo unknown)"
    bal="$(cast balance "$addr" --rpc-url "$BASE_SEPOLIA_RPC_URL" --ether 2>/dev/null || echo unknown)"
    chain="$(cast chain-id --rpc-url "$BASE_SEPOLIA_RPC_URL" 2>/dev/null || echo unknown)"
    addr_lc="$(printf '%s' "$addr" | tr '[:upper:]' '[:lower:]')"
    echo "deployer=$addr"
    echo "balance_eth=$bal"
    echo "chain_id=$chain (expected 84532)"
    if [[ "$addr" != "unknown" ]] && is_anvil_address "$addr_lc"; then
      refuse_anvil_deployer
      echo "anvil_addr_gate=FAIL (deployer is Anvil #0–#9)"
      ok=1
    elif [[ "$addr" != "unknown" ]]; then
      echo "anvil_addr_gate=PASS"
    fi
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
    if [[ -n "${PRIVATE_KEY:-}" ]] && is_anvil_private_key; then
      refuse_anvil_deployer
      exit 1
    fi
    check_env || {
      echo "Refusing broadcast: env/balance/Anvil gate failed. Use a funded non-Anvil deployer." >&2
      echo "See docs/WAVE_13_STAGE_A_GO_LIVE.md" >&2
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
