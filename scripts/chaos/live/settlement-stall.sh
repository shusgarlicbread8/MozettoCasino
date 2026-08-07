#!/usr/bin/env bash
# Live chaos (WP-113): stall full settlement path (verifier + worker), then recover.
# Complements worker-restart.sh by also bouncing the replay attestor dependency.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=../lib.sh
source "$SCRIPT_DIR/../lib.sh"

require_hosted_stack

if ! http_ok "$WORKER_HEALTH_URL"; then
  chaos_fail "worker not healthy at $WORKER_HEALTH_URL — start hosted stack first"
fi
if ! http_ok "$VERIFIER_HEALTH_URL"; then
  chaos_fail "verifier not healthy at $VERIFIER_HEALTH_URL — start hosted stack first"
fi

chaos_log "scenario=settlement-stall"
chaos_log "expected: kill verifier+worker → restart verifier then worker → both /health ok; no double-pay"

chaos_log "killing settlement path (verifier + worker)"
hosted_compose kill -s SIGKILL verifier worker || hosted_compose kill verifier worker
wait_http_down "$VERIFIER_HEALTH_URL" 45 "verifier"
wait_http_down "$WORKER_HEALTH_URL" 45 "worker"

chaos_log "holding settlement stall for ${SETTLEMENT_STALL_SEC:-5}s"
sleep "${SETTLEMENT_STALL_SEC:-5}"

chaos_log "starting verifier (worker depends on attest)"
hosted_compose start verifier >/dev/null 2>&1 || true
wait_http_ok "$VERIFIER_HEALTH_URL" 120 "verifier"

chaos_log "starting worker"
hosted_compose start worker >/dev/null 2>&1 || true
wait_http_ok "$WORKER_HEALTH_URL" 120 "worker"

after_v="$(http_json "$VERIFIER_HEALTH_URL")"
after_w="$(http_json "$WORKER_HEALTH_URL")"
assert_json_field_present "$after_v" "ok"
assert_json_field_present "$after_w" "ok"

chaos_log "PASS settlement-stall (verifier + worker restored)"
chaos_log "assert double-pay via unit suite + Hub AlreadySettled (forge PokerSettlementHubV3)"
chaos_log "manual: seed ready-to-settle session, stall mid-submit, confirm single Hub settle + vault credit"
