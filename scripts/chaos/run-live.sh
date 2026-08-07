#!/usr/bin/env bash
# WP-113 live chaos against docker-compose.hosted.yml (+ local postgres/redis).
# Not run in default CI — requires CHAOS_LIVE=1, a running stack, and Docker.
# Never targets production (refuses MOZETTO_CHAIN_ENV=base|mainnet|prod).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

SCENARIO="${1:-all}"

LIVE_CORE=(
  game-kill
  dealer-kill
  indexer-restart
  rpc-stall
  worker-restart
  settlement-stall
  vrf-stall
)

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

list_scenarios() {
  cat <<EOF
Live scenarios (CHAOS_LIVE=1 required):
  ${LIVE_CORE[*]}
  redis-kill          (auto if mozetto-redis up, or CHAOS_REDIS_KILL=1)
  db-disconnect       (opt-in: CHAOS_DB_DISCONNECT=1)

Matrix: scripts/chaos/live/EXPECTED_OUTCOMES.md
Docs:   docs/WP-113_LIVE_CHAOS.md
EOF
}

case "$SCENARIO" in
  list|-h|--help)
    list_scenarios
    exit 0
    ;;
esac

require_chaos_live_gate
refuse_production_targets

case "$SCENARIO" in
  all)
    chaos_log "WP-113 live chaos — core multi-container drills"
    for name in "${LIVE_CORE[@]}"; do
      run_one "$name"
    done
    if container_running mozetto-redis || [[ "${CHAOS_REDIS_KILL:-0}" == "1" ]]; then
      run_one redis-kill
    else
      chaos_log "skip redis-kill (start mozetto-redis or set CHAOS_REDIS_KILL=1)"
    fi
    if [[ "${CHAOS_DB_DISCONNECT:-0}" == "1" ]]; then
      run_one db-disconnect
    else
      chaos_log "skip db-disconnect (set CHAOS_DB_DISCONNECT=1 to enable)"
    fi
    ;;
  game-kill|dealer-kill|indexer-restart|rpc-stall|worker-restart|settlement-stall|vrf-stall|redis-kill|db-disconnect)
    run_one "$SCENARIO"
    ;;
  *)
    echo "Usage: CHAOS_LIVE=1 $0 [all|list|game-kill|dealer-kill|indexer-restart|rpc-stall|worker-restart|settlement-stall|vrf-stall|redis-kill|db-disconnect]" >&2
    exit 2
    ;;
esac

chaos_log "live chaos finished: $SCENARIO"
