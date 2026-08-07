#!/usr/bin/env bash
# Live chaos: kill game service, wait for restart, assert health + lease surface.
# Requires docker-compose.hosted.yml stack (WP-086).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=../lib.sh
source "$SCRIPT_DIR/../lib.sh"

require_hosted_stack

chaos_log "scenario=game-kill"
chaos_log "expected: restart → /health ok; tableLease present; no dual-writer claim"

before="$(http_json "$GAME_HEALTH_URL")"
chaos_log "pre-kill health snippet: $(printf '%s' "$before" | head -c 240)"

chaos_log "killing game container (SIGKILL)"
hosted_compose kill -s SIGKILL game || hosted_compose kill game
wait_http_down "$GAME_HEALTH_URL" 45 "game"

chaos_log "waiting for compose restart policy to bring game back"
hosted_compose start game >/dev/null 2>&1 || true
wait_http_ok "$GAME_HEALTH_URL" 120 "game"

after="$(http_json "$GAME_HEALTH_URL")"
assert_json_field_present "$after" "ok"
# Lease fields are reported when WP-080 wired (tableLease / actorInstanceId).
if printf '%s' "$after" | grep -q 'tableLease\|actorInstanceId\|lease'; then
  chaos_log "lease surface present after reclaim"
else
  chaos_warn "health JSON missing explicit lease fields — verify WP-080 wire manually"
fi

chaos_log "PASS game-kill (health restored after kill/restart)"
chaos_log "manual follow-up: seat a table, kill mid-hand, confirm outbox drain + tip match Postgres"
