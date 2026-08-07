#!/usr/bin/env bash
# WP-103 — Lightweight HTTP health checks for hosted testnet services.
# Set URLs via env; skips missing URLs with WARN (does not invent endpoints).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

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

echo "== WP-103 testnet health =="
echo "Unset URLs are skipped (configure after hosted cutover)."
echo ""

ok=0
checked=0

probe() {
  local name="$1"
  local base="$2"
  local path="${3:-/health}"
  if [[ -z "$base" ]]; then
    echo "SKIP: $name (URL unset)"
    return 0
  fi
  checked=$((checked + 1))
  local url="${base%/}${path}"
  local code
  code="$(curl -sS -o /tmp/mozetto-testnet-health.body -w '%{http_code}' --connect-timeout 5 --max-time 15 "$url" || true)"
  if [[ "$code" == "200" ]]; then
    echo "OK:   $name $url → $code"
  else
    echo "FAIL: $name $url → HTTP ${code:-error}"
    ok=1
  fi
}

# Prefer explicit TESTNET_* then common NEXT_PUBLIC / service envs
API_URL="${TESTNET_API_URL:-${NEXT_PUBLIC_API_URL:-}}"
GAME_URL="${TESTNET_GAME_URL:-${NEXT_PUBLIC_GAME_HTTP_URL:-${GAME_SERVER_URL:-}}}"
DEALER_URL="${TESTNET_DEALER_URL:-${DEALER_URL:-}}"
VERIFIER_URL="${TESTNET_VERIFIER_URL:-${REPLAY_VERIFIER_URL:-${VERIFIER_URL:-}}}"
INDEXER_URL="${TESTNET_INDEXER_URL:-${INDEXER_URL:-}}"
WORKER_URL="${TESTNET_WORKER_URL:-${SETTLEMENT_WORKER_URL:-${WORKER_URL:-}}}"
AGENT_URL="${TESTNET_AGENT_URL:-${AGENT_RUNTIME_URL:-}}"
WEB_URL="${TESTNET_WEB_URL:-${NEXT_PUBLIC_WEB_URL:-}}"

probe "api" "$API_URL" "/health"
probe "game" "$GAME_URL" "/health"
probe "dealer" "$DEALER_URL" "/health"
probe "verifier" "$VERIFIER_URL" "/health"
probe "indexer" "$INDEXER_URL" "/health"
probe "worker" "$WORKER_URL" "/health"
probe "agent" "$AGENT_URL" "/health"

if [[ -n "$WEB_URL" ]]; then
  checked=$((checked + 1))
  code="$(curl -sS -o /dev/null -w '%{http_code}' --connect-timeout 5 --max-time 15 "${WEB_URL%/}/" || true)"
  if [[ "$code" =~ ^2 ]]; then
    echo "OK:   web $WEB_URL → $code"
  else
    echo "FAIL: web $WEB_URL → HTTP ${code:-error}"
    ok=1
  fi
else
  echo "SKIP: web (TESTNET_WEB_URL / NEXT_PUBLIC_WEB_URL unset)"
fi

echo ""
if (( checked == 0 )); then
  echo "WARN: no service URLs configured — not a pass. Set TESTNET_*_URL after hosted deploy."
  exit 2
fi

if (( ok != 0 )); then
  echo "FAIL: one or more health probes failed"
  exit 1
fi

echo "PASS: $checked endpoint(s) healthy"
exit 0
