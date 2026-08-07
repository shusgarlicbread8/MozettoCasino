#!/usr/bin/env bash
# WP-062 — Anvil proof-batch publisher stub (Foundry).
# Continuous TS publisher: packages/proof-batch-publisher (WP-085).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/contracts"

RPC_URL="${ANVIL_RPC_URL:-http://127.0.0.1:8545}"
ARGS=(script/PublishProofBatchAnvil.s.sol --rpc-url "$RPC_URL" --broadcast -vv)

if [[ -n "${PROOF_BATCH_REGISTRY_ADDRESS:-}" ]]; then
  echo "Using PROOF_BATCH_REGISTRY_ADDRESS=$PROOF_BATCH_REGISTRY_ADDRESS"
else
  echo "PROOF_BATCH_REGISTRY_ADDRESS unset — script will deploy a fresh registry"
fi

forge script "${ARGS[@]}"
