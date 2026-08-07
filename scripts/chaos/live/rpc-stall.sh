#!/usr/bin/env bash
# Live chaos (WP-113): stall RPC consumers (indexer + settlement worker).
# True primary→fallback RPC cutover is ops/config (dual RPC URLs); this drill
# verifies compose services recover after an RPC-unavailable window.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=../lib.sh
source "$SCRIPT_DIR/../lib.sh"

require_hosted_stack

if ! http_ok "$INDEXER_HEALTH_URL"; then
  chaos_fail "indexer not healthy at $INDEXER_HEALTH_URL — start hosted stack first"
fi
if ! http_ok "$WORKER_HEALTH_URL"; then
  chaos_fail "worker not healthy at $WORKER_HEALTH_URL — start hosted stack first"
fi

chaos_log "scenario=rpc-stall"
chaos_log "expected: stop RPC consumers → no new index/settle progress; restart → /health ok; idempotent catch-up"

before_idx="$(http_json "$INDEXER_HEALTH_URL")"
chaos_log "pre-stop indexer: $(printf '%s' "$before_idx" | head -c 200)"

chaos_log "stopping indexer + worker (simulate RPC blackhole for consumers)"
hosted_compose stop indexer worker
wait_http_down "$INDEXER_HEALTH_URL" 45 "indexer"
wait_http_down "$WORKER_HEALTH_URL" 45 "worker"

chaos_log "holding RPC stall for ${RPC_STALL_SEC:-8}s"
sleep "${RPC_STALL_SEC:-8}"

chaos_log "starting indexer + worker"
hosted_compose start indexer worker
wait_http_ok "$INDEXER_HEALTH_URL" 120 "indexer"
wait_http_ok "$WORKER_HEALTH_URL" 120 "worker"

after_idx="$(http_json "$INDEXER_HEALTH_URL")"
after_w="$(http_json "$WORKER_HEALTH_URL")"
assert_json_field_present "$after_idx" "ok"
assert_json_field_present "$after_w" "ok"

chaos_log "PASS rpc-stall (indexer + worker restored after consumer stall)"
chaos_log "gap: dual RPC URL failover not automated here — configure BASE_SEPOLIA_RPC_URL + fallback in ops"
chaos_log "manual: point RPC at a blackhole proxy, confirm indexer lag grows then recovers without money invent"
