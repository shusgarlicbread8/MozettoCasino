#!/usr/bin/env bash
# Live chaos: kill settlement worker, restart, assert health.
# Double-pay safety is enforced on-chain (AlreadySettled) + DB proposal guards;
# this script verifies process recovery. Full settle race needs a seeded session.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=../lib.sh
source "$SCRIPT_DIR/../lib.sh"

require_hosted_stack

if ! http_ok "$WORKER_HEALTH_URL"; then
  chaos_fail "worker not healthy at $WORKER_HEALTH_URL — start hosted stack first"
fi

chaos_log "scenario=worker-restart"
chaos_log "expected: kill/restart → /health ok; no second settle when session already settled"

hosted_compose kill -s SIGKILL worker || hosted_compose kill worker
wait_http_down "$WORKER_HEALTH_URL" 45 "worker"

hosted_compose start worker >/dev/null 2>&1 || true
wait_http_ok "$WORKER_HEALTH_URL" 120 "worker"

after="$(http_json "$WORKER_HEALTH_URL")"
assert_json_field_present "$after" "ok"

chaos_log "PASS worker-restart (health restored)"
chaos_log "assert double-pay via unit suite + Hub AlreadySettled (forge PokerSettlementHubV3)"
chaos_log "manual: settle once, restart worker, confirm proposal skip / AlreadySettled noop"
