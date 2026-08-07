#!/usr/bin/env bash
# Live chaos: pause local Postgres to simulate DB disconnect, then resume.
# Uses docker-compose.yml postgres (mozetto-postgres). Hosted app containers
# should surface write failures without broadcasting (WP-081).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=../lib.sh
source "$SCRIPT_DIR/../lib.sh"

require_docker

chaos_log "scenario=db-disconnect"
chaos_log "expected: pause DB → game/api writes fail safely; resume → outbox catch-up possible"

if ! docker ps --format '{{.Names}}' | grep -qx 'mozetto-postgres'; then
  chaos_warn "mozetto-postgres not running"
  chaos_warn "start with: docker compose -f docker-compose.yml up -d"
  chaos_fail "db-disconnect live scenario requires local postgres container"
fi

# Optional: probe game before pause.
if http_ok "$GAME_HEALTH_URL"; then
  chaos_log "game was healthy before DB pause"
fi

chaos_log "pausing postgres (freeze connections)"
docker pause mozetto-postgres

chaos_log "holding disconnect for ${DB_PAUSE_SEC:-5}s"
sleep "${DB_PAUSE_SEC:-5}"

# Best-effort: a mutating call should fail or time out. We do not invent one;
# operators can hit a table act endpoint. Health may still answer from memory.
if http_ok "$GAME_HEALTH_URL"; then
  chaos_warn "game /health still answers during DB pause (expected if health is memory-only)"
fi

chaos_log "unpausing postgres"
docker unpause mozetto-postgres

# Wait for postgres ready.
for _ in $(seq 1 30); do
  if docker exec mozetto-postgres pg_isready -U mozetto -d mozetto >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if http_ok "$GAME_HEALTH_URL"; then
  wait_http_ok "$GAME_HEALTH_URL" 60 "game-after-db-resume"
fi

chaos_log "PASS db-disconnect (postgres pause/resume completed)"
chaos_log "assert persist-before-broadcast via unit suite; live: confirm no ghost WS events during pause"
