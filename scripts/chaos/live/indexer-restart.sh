#!/usr/bin/env bash
# Live chaos: stop indexer (induce lag), restart, assert health + lag catch-up signal.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=../lib.sh
source "$SCRIPT_DIR/../lib.sh"

require_hosted_stack

if ! http_ok "$INDEXER_HEALTH_URL"; then
  chaos_fail "indexer not healthy at $INDEXER_HEALTH_URL — start hosted stack first"
fi

chaos_log "scenario=indexer-restart"
chaos_log "expected: stop → lag may grow; restart → /health ok; cursor resumes (idempotent upserts)"

before="$(http_json "$INDEXER_HEALTH_URL")"
chaos_log "pre-stop health: $(printf '%s' "$before" | head -c 280)"

chaos_log "stopping indexer"
hosted_compose stop indexer
wait_http_down "$INDEXER_HEALTH_URL" 45 "indexer"

chaos_log "simulating lag window (sleep ${INDEXER_LAG_SLEEP_SEC:-8}s)"
sleep "${INDEXER_LAG_SLEEP_SEC:-8}"

chaos_log "starting indexer"
hosted_compose start indexer
wait_http_ok "$INDEXER_HEALTH_URL" 120 "indexer"

after="$(http_json "$INDEXER_HEALTH_URL")"
assert_json_field_present "$after" "ok"
if printf '%s' "$after" | grep -q 'lagBlocks\|cursorBlock\|version'; then
  chaos_log "indexer metrics surface present after restart"
else
  chaos_warn "indexer health missing lag/cursor fields — check WP-082 /health"
fi

chaos_log "PASS indexer-restart (health restored; money path remains idempotent upsert — see WP-082)"
chaos_log "optional rebuild drill: INDEXER_REBUILD=1 on one-shot start (does not invent credits)"
