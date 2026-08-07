#!/usr/bin/env bash
# Live chaos (WP-113): interrupt settlement-worker during mock-VRF window.
# Full Chainlink VRF fulfillment race needs a seeded Anvil session
# (ENABLE_MOCK_VRF=1). This drill asserts process recovery + documents safety.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=../lib.sh
source "$SCRIPT_DIR/../lib.sh"

require_hosted_stack

if ! http_ok "$WORKER_HEALTH_URL"; then
  chaos_fail "worker not healthy at $WORKER_HEALTH_URL — start hosted stack first"
fi
if ! http_ok "$DEALER_HEALTH_URL"; then
  chaos_warn "dealer not healthy — VRF path depends on dealer commit; continuing worker-only stall"
fi

chaos_log "scenario=vrf-stall"
chaos_log "expected: kill worker during VRF/fulfillment path → restart → /health ok; no double fulfill / double settle"

before="$(http_json "$WORKER_HEALTH_URL")"
chaos_log "pre-kill worker: $(printf '%s' "$before" | head -c 200)"

kill_and_restart_service worker "$WORKER_HEALTH_URL" "worker"

after="$(http_json "$WORKER_HEALTH_URL")"
assert_json_field_present "$after" "ok"
assert_json_field_present "$after" "service"

if [[ -f "$HOSTED_ENV_FILE" ]] && grep -qE '^ENABLE_MOCK_VRF=1' "$HOSTED_ENV_FILE"; then
  chaos_log "ENABLE_MOCK_VRF=1 detected — Anvil mock fulfill path is in play"
else
  chaos_warn "ENABLE_MOCK_VRF not set in .env.hosted — live VRF fulfill race is a manual Anvil follow-up"
fi

chaos_log "PASS vrf-stall (worker restored; fulfillment must remain idempotent)"
chaos_log "assert: RandomnessCoordinator fulfill once; Hub AlreadySettled on duplicate settle (forge + unit)"
chaos_log "manual: open session → dealer commit → kill worker mid mock-VRF → restart → single fulfill + settle"
