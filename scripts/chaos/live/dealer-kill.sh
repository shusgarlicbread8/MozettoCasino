#!/usr/bin/env bash
# Live chaos (WP-113): kill dealer parent process, wait for restart, assert health.
# Enclave/vsock path is Nitro-only (WP-052) — this drills the hosted dealer container.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=../lib.sh
source "$SCRIPT_DIR/../lib.sh"

require_hosted_stack

if ! http_ok "$DEALER_HEALTH_URL"; then
  chaos_fail "dealer not healthy at $DEALER_HEALTH_URL — start hosted stack first"
fi

chaos_log "scenario=dealer-kill"
chaos_log "expected: SIGKILL dealer → restart → /health ok; attest-v3 surface; no secret leak in health"

before="$(http_json "$DEALER_HEALTH_URL")"
chaos_log "pre-kill dealer: $(printf '%s' "$before" | head -c 200)"
assert_json_field_present "$before" "ok"

kill_and_restart_service dealer "$DEALER_HEALTH_URL" "dealer"

after="$(http_json "$DEALER_HEALTH_URL")"
assert_json_field_present "$after" "ok"
assert_json_field_present "$after" "service"
if printf '%s' "$after" | grep -q 'attestV3\|attest'; then
  chaos_log "attest surface present after restart"
else
  chaos_warn "dealer health missing attest hint — check /v1/dealer/attest-v3 manually"
fi

# Game may briefly fail deal-dependent calls; health should still answer if up.
if http_ok "$GAME_HEALTH_URL"; then
  chaos_log "game still reachable after dealer reclaim"
fi

chaos_log "PASS dealer-kill (dealer health restored after kill/restart)"
chaos_log "manual: mid-hand deal request during dealer down → fail closed; after restart, new commit ok"
chaos_log "gap: Nitro enclave/vsock disconnect not automated (requires real AWS Nitro)"
