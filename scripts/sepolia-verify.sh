#!/usr/bin/env bash
# WP-102 — Verify Base Sepolia contracts from chain-manifest (post-deploy).
# Requires BASESCAN_API_KEY + BASE_SEPOLIA_RPC_URL + non-null addresses in baseSepolia.json.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MANIFEST="$ROOT/packages/chain-manifest/deployments/baseSepolia.json"

if [[ -f "$ROOT/.env.local" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env.local"
  set +a
fi
if [[ -z "${BASE_SEPOLIA_RPC_URL:-}" && -n "${SEPOLIA_RPC_URL:-}" ]]; then
  export BASE_SEPOLIA_RPC_URL="$SEPOLIA_RPC_URL"
fi

if [[ -z "${BASESCAN_API_KEY:-}" ]]; then
  echo "MISSING: BASESCAN_API_KEY" >&2
  exit 1
fi
if [[ -z "${BASE_SEPOLIA_RPC_URL:-}" ]]; then
  echo "MISSING: BASE_SEPOLIA_RPC_URL (or SEPOLIA_RPC_URL)" >&2
  exit 1
fi
if [[ ! -f "$MANIFEST" ]]; then
  echo "MISSING: $MANIFEST — run DeploySepolia broadcast first" >&2
  exit 1
fi

cd "$ROOT"
# Extract hex addresses; skip nulls
mapfile -t PAIRS < <(python3 - <<'PY'
import json
from pathlib import Path
m = json.loads(Path("packages/chain-manifest/deployments/baseSepolia.json").read_text())
# contract name hints for forge verify-contract (best-effort; constructor args may need broadcast artifacts)
keys = [
  ("arenaVault", "ArenaVaultV2"),
  ("arenaVaultV1", "ArenaVaultV1"),
  ("arenaAccountFactory", "ArenaAccountFactory"),
  ("arenaAccountImplementation", "ArenaAccount"),
  ("tableRegistry", "TableRegistryV1"),
  ("gameRegistry", "GameRegistryV2"),
  ("sessionLifecycle", "SessionLifecycleV2"),
  ("protocolFeeVault", "ProtocolFeeVault"),
  ("settlementHubV1", "PokerSettlementHubV1"),
  ("settlementHubV2", "PokerSettlementHubV2"),
  ("settlementHubV3", "PokerSettlementHubV3"),
  ("verifierRouter", "VerifierRouter"),
  ("signatureQuorumVerifier", "SignatureQuorumVerifier"),
  ("checkpointRegistry", "CheckpointRegistryV1"),
  ("randomnessCoordinator", "RandomnessCoordinatorV1"),
  ("randomnessBeacon", "RandomnessBeaconV2"),
  ("chainlinkVrfAdapter", "ChainlinkVrfAdapterV1"),
  ("proofBatchRegistry", "ProofBatchRegistryV1"),
]
any_addr = False
for k, name in keys:
    v = m.get(k)
    if isinstance(v, str) and v.startswith("0x") and len(v) == 42:
        print(f"{v}|{name}")
        any_addr = True
if not any_addr:
    raise SystemExit("No deployed addresses in baseSepolia.json (still null). Live deploy pending ops.")
PY
)

echo "== WP-102 verify from manifest ($(printf '%s\n' "${PAIRS[@]}" | wc -l | tr -d ' ') contracts) =="
echo "Prefer: forge script … --broadcast --verify (constructor args from broadcast)."
echo "This script attempts forge verify-contract per address; complex constructors may need --constructor-args from broadcast/run-latest.json."

cd "$ROOT/contracts"
fail=0
for pair in "${PAIRS[@]}"; do
  addr="${pair%%|*}"
  name="${pair##*|}"
  echo "-- $name @ $addr"
  if forge verify-contract \
    --chain-id 84532 \
    --etherscan-api-key "$BASESCAN_API_KEY" \
    --watch \
    "$addr" \
    "src/${name}.sol:${name}"; then
    echo "OK $name"
  else
    echo "WARN verify failed for $name (use broadcast --verify or supply constructor args)" >&2
    fail=1
  fi
done

exit "$fail"
