#!/usr/bin/env bash
# WP-101 live chaos against docker-compose.hosted.yml (+ local postgres for db-disconnect).
# Not run in default CI — requires a running stack and Docker.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

SCENARIO="${1:-all}"

run_one() {
  local name="$1"
  local path="$SCRIPT_DIR/live/${name}.sh"
  if [[ ! -x "$path" && -f "$path" ]]; then
    chmod +x "$path"
  fi
  if [[ ! -f "$path" ]]; then
    chaos_fail "unknown live scenario: $name"
  fi
  bash "$path"
}

case "$SCENARIO" in
  all)
    run_one game-kill
    run_one indexer-restart
    run_one worker-restart
    # db-disconnect is opt-in (destructive to shared local DB connections)
    if [[ "${CHAOS_DB_DISCONNECT:-0}" == "1" ]]; then
      run_one db-disconnect
    else
      chaos_log "skip db-disconnect (set CHAOS_DB_DISCONNECT=1 to enable)"
    fi
    ;;
  game-kill|indexer-restart|worker-restart|db-disconnect)
    run_one "$SCENARIO"
    ;;
  *)
    echo "Usage: $0 [all|game-kill|indexer-restart|worker-restart|db-disconnect]" >&2
    exit 2
    ;;
esac

chaos_log "live chaos finished: $SCENARIO"
