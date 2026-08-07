#!/usr/bin/env bash
# WP-103 — Stage A entry gate (manifest + lightweight env honesty checks).
# Does not broadcast. Fails while baseSepolia protocol addresses are null.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

echo "== WP-103 Stage A gate =="
echo "docs: docs/WP-103_PUBLIC_TESTNET_PROGRAM.md"
echo ""

set +e
node "$ROOT/scripts/testnet/check-manifest.mjs"
GATE_RC=$?
set -e

echo ""
echo "== Attestor / labelled-env hints (names only) =="
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
    echo "UNSET: $name (ops should set before live Stage A)"
  fi
}

hint ATTESTOR_MIN_SIGNATURES
hint ATTESTOR_1_ADDRESS
hint ATTESTOR_2_ADDRESS
hint ATTESTOR_3_ADDRESS
hint BASE_SEPOLIA_RPC_URL
hint NEXT_PUBLIC_API_URL
hint DATABASE_URL

min="${ATTESTOR_MIN_SIGNATURES:-}"
if [[ -n "$min" ]]; then
  if [[ "$min" =~ ^[0-9]+$ ]] && (( min >= 3 )); then
    echo "OK:   ATTESTOR_MIN_SIGNATURES=$min (>= 3)"
  else
    echo "WARN: ATTESTOR_MIN_SIGNATURES=$min — raise toward 3 before Stage A"
  fi
fi

echo ""
echo "Human checklist: scripts/testnet/STAGE_A_CHECKLIST.md"
echo "Pause runbook:   scripts/testnet/PAUSE_RUNBOOK.md"
echo "Health (optional): pnpm testnet:health"
echo "Verify CLI hints:  pnpm testnet:verify-hints"

exit "$GATE_RC"
