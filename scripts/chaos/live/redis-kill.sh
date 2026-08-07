#!/usr/bin/env bash
# Live chaos (WP-113): pause local Redis to simulate lease-backend failure, then resume.
# Uses docker-compose.yml redis (mozetto-redis). Hosted game should recover leases
# after Redis returns (single-replica memory backend if REDIS_URL unset).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=../lib.sh
source "$SCRIPT_DIR/../lib.sh"

require_docker
require_chaos_live_gate
refuse_production_targets

chaos_log "scenario=redis-kill"
chaos_log "expected: pause Redis → multi-replica lease ops fail closed; resume → game /health ok; no dual-writer"

if ! container_running mozetto-redis; then
  chaos_warn "mozetto-redis not running"
  chaos_warn "start with: docker compose -f docker-compose.yml up -d redis"
  chaos_fail "redis-kill live scenario requires local redis container"
fi

if http_ok "$GAME_HEALTH_URL"; then
  before="$(http_json "$GAME_HEALTH_URL")"
  chaos_log "pre-pause game health: $(printf '%s' "$before" | head -c 240)"
  if printf '%s' "$before" | grep -qi 'redis\|tableLease'; then
    chaos_log "lease surface visible before Redis pause"
  fi
else
  chaos_warn "game not reachable — continuing Redis pause/resume drill only"
fi

chaos_log "pausing redis (freeze connections)"
docker pause mozetto-redis

chaos_log "holding disconnect for ${REDIS_PAUSE_SEC:-5}s"
sleep "${REDIS_PAUSE_SEC:-5}"

if http_ok "$GAME_HEALTH_URL"; then
  chaos_warn "game /health still answers during Redis pause (expected if health is memory-only)"
fi

chaos_log "unpausing redis"
docker unpause mozetto-redis

for _ in $(seq 1 30); do
  if docker exec mozetto-redis redis-cli ping 2>/dev/null | grep -qi PONG; then
    break
  fi
  sleep 1
done

if http_ok "$GAME_HEALTH_URL"; then
  wait_http_ok "$GAME_HEALTH_URL" 60 "game-after-redis-resume"
  after="$(http_json "$GAME_HEALTH_URL")"
  assert_json_field_present "$after" "ok"
fi

chaos_log "PASS redis-kill (redis pause/resume completed)"
chaos_log "assert dual-writer fencing via unit suite + staging ≥2 game replicas with REDIS_URL"
chaos_log "manual: seat table on replica A, pause Redis, confirm B cannot steal live lease"
