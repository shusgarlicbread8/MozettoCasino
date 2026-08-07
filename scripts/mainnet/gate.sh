#!/usr/bin/env bash
# WP-105 — Restricted mainnet entry gate (recipes only; never broadcasts).
# Fails until Plan 14 readiness gates + finalGateApproval are satisfied AND
# (optionally) base.json is filled after an approved live deploy.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

MODE="${1:-entry}" # entry | honesty | deployed

echo "== WP-105 Restricted mainnet gate =="
echo "docs: docs/WP-105_RESTRICTED_MAINNET.md"
echo "mode: $MODE"
echo ""

set +e
node "$ROOT/scripts/mainnet/check-gates.mjs"
GATES_RC=$?
set -e

echo ""

MANIFEST_RC=0
case "$MODE" in
  honesty)
    set +e
    node "$ROOT/scripts/mainnet/check-manifest.mjs" --honesty
    MANIFEST_RC=$?
    set -e
    ;;
  deployed)
    set +e
    node "$ROOT/scripts/mainnet/check-manifest.mjs"
    MANIFEST_RC=$?
    set -e
    ;;
  entry)
    # Entry readiness: gates must pass; manifest may still be null until broadcast.
    # Also run honesty check so fake fills cannot sneak in before approval.
    set +e
    node "$ROOT/scripts/mainnet/check-manifest.mjs" --honesty
    MANIFEST_RC=$?
    set -e
    ;;
  *)
    echo "Usage: $0 [entry|honesty|deployed]" >&2
    exit 2
    ;;
esac

echo ""
echo "== Env checklist hints (names only; values not printed) =="
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

hint() {
  local name="$1"
  if [[ -n "${!name:-}" ]]; then
    echo "SET:  $name"
  else
    echo "UNSET: $name"
  fi
}

hint BASE_RPC_URL
hint PRIVATE_KEY
hint BASESCAN_API_KEY
hint PROTOCOL_SAFE_ADDRESS
hint TREASURY_SAFE_ADDRESS
hint TIMELOCK_CONTROLLER_ADDRESS
hint ATTESTOR_MIN_SIGNATURES
hint MOZETTO_MAINNET_FINAL_GATE_APPROVED
hint MAINNET_ALLOWLIST_ENABLED
hint MAINNET_MAX_BUY_IN_USDC
hint MAINNET_MAX_CONCURRENT_SESSIONS

echo ""
echo "Human checklist: scripts/mainnet/RESTRICTED_MAINNET_CHECKLIST.md"
echo "Deploy recipe:   scripts/mainnet/deploy.sh (refuses broadcast until gate + approval)"

if [[ "$GATES_RC" -ne 0 || "$MANIFEST_RC" -ne 0 ]]; then
  echo ""
  echo "OVERALL: BLOCKED (gates_rc=$GATES_RC manifest_rc=$MANIFEST_RC)"
  exit 1
fi

echo ""
echo "OVERALL: PASS"
exit 0
