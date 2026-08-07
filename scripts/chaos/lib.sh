#!/usr/bin/env bash
# Shared helpers for Mozetto WP-101 / WP-113 chaos scripts.
# shellcheck disable=SC2034
set -euo pipefail

CHAOS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$CHAOS_ROOT/../.." && pwd)"

HOSTED_COMPOSE="${HOSTED_COMPOSE:-$REPO_ROOT/docker-compose.hosted.yml}"
DATA_COMPOSE="${DATA_COMPOSE:-$REPO_ROOT/docker-compose.yml}"
HOSTED_ENV_FILE="${HOSTED_ENV_FILE:-$REPO_ROOT/.env.hosted}"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-mozetto-hosted}"

GAME_HEALTH_URL="${GAME_HEALTH_URL:-http://127.0.0.1:4001/health}"
INDEXER_HEALTH_URL="${INDEXER_HEALTH_URL:-http://127.0.0.1:4010/health}"
WORKER_HEALTH_URL="${WORKER_HEALTH_URL:-http://127.0.0.1:4011/health}"
API_HEALTH_URL="${API_HEALTH_URL:-http://127.0.0.1:4000/health}"
DEALER_HEALTH_URL="${DEALER_HEALTH_URL:-http://127.0.0.1:4003/health}"
VERIFIER_HEALTH_URL="${VERIFIER_HEALTH_URL:-http://127.0.0.1:4004/health}"
AGENT_HEALTH_URL="${AGENT_HEALTH_URL:-http://127.0.0.1:4002/health}"

chaos_log() {
  printf '[chaos] %s\n' "$*"
}

chaos_warn() {
  printf '[chaos:warn] %s\n' "$*" >&2
}

chaos_fail() {
  printf '[chaos:fail] %s\n' "$*" >&2
  exit 1
}

hosted_compose() {
  local args=(-f "$HOSTED_COMPOSE" -p "$COMPOSE_PROJECT")
  if [[ -f "$HOSTED_ENV_FILE" ]]; then
    args+=(--env-file "$HOSTED_ENV_FILE")
  fi
  docker compose "${args[@]}" "$@"
}

data_compose() {
  docker compose -f "$DATA_COMPOSE" "$@"
}

http_ok() {
  local url="$1"
  curl -fsS --max-time 3 "$url" >/dev/null 2>&1
}

http_json() {
  local url="$1"
  curl -fsS --max-time 5 "$url" 2>/dev/null || true
}

wait_http_ok() {
  local url="$1"
  local timeout_sec="${2:-90}"
  local label="${3:-$url}"
  local start
  start="$(date +%s)"
  while true; do
    if http_ok "$url"; then
      chaos_log "healthy: $label"
      return 0
    fi
    local now
    now="$(date +%s)"
    if (( now - start >= timeout_sec )); then
      chaos_fail "timeout waiting for healthy: $label ($url)"
    fi
    sleep 2
  done
}

wait_http_down() {
  local url="$1"
  local timeout_sec="${2:-30}"
  local label="${3:-$url}"
  local start
  start="$(date +%s)"
  while true; do
    if ! http_ok "$url"; then
      chaos_log "down: $label"
      return 0
    fi
    local now
    now="$(date +%s)"
    if (( now - start >= timeout_sec )); then
      chaos_fail "timeout waiting for down: $label ($url)"
    fi
    sleep 1
  done
}

require_docker() {
  command -v docker >/dev/null 2>&1 || chaos_fail "docker is required for live chaos"
  docker compose version >/dev/null 2>&1 || chaos_fail "docker compose is required for live chaos"
}

require_chaos_live_gate() {
  if [[ "${CHAOS_LIVE:-0}" != "1" ]]; then
    chaos_fail "live chaos refused: set CHAOS_LIVE=1 (never against production). See docs/WP-113_LIVE_CHAOS.md"
  fi
}

refuse_production_targets() {
  local env_name="${MOZETTO_CHAIN_ENV:-}"
  if [[ -z "$env_name" && -f "$HOSTED_ENV_FILE" ]]; then
    env_name="$(grep -E '^MOZETTO_CHAIN_ENV=' "$HOSTED_ENV_FILE" 2>/dev/null | tail -n1 | cut -d= -f2- | tr -d \"\' || true)"
  fi
  case "${env_name}" in
    base|mainnet|base-mainnet|production|prod)
      chaos_fail "refusing live chaos against MOZETTO_CHAIN_ENV=${env_name} (production-like). Use anvil/base-sepolia staging only."
      ;;
  esac
  if [[ "${CHAOS_ALLOW_PROD:-0}" == "1" ]]; then
    chaos_fail "CHAOS_ALLOW_PROD is unsupported — live chaos must never target production"
  fi
}

require_hosted_stack() {
  require_docker
  require_chaos_live_gate
  refuse_production_targets
  if [[ ! -f "$HOSTED_COMPOSE" ]]; then
    chaos_fail "missing $HOSTED_COMPOSE"
  fi
  if ! http_ok "$GAME_HEALTH_URL" && ! http_ok "$API_HEALTH_URL"; then
    chaos_warn "hosted stack does not look up (game/api health failed)"
    chaos_warn "start with: docker compose -f docker-compose.hosted.yml --env-file .env.hosted up -d --build"
    chaos_fail "live chaos requires a running hosted stack (see docs/WP-113_LIVE_CHAOS.md)"
  fi
}

container_running() {
  local name="$1"
  docker ps --format '{{.Names}}' | grep -qx "$name"
}

assert_json_field_present() {
  local json="$1"
  local field="$2"
  if ! printf '%s' "$json" | grep -q "\"$field\""; then
    chaos_fail "expected JSON field '$field' in: $json"
  fi
}

kill_and_restart_service() {
  local service="$1"
  local health_url="$2"
  local label="${3:-$service}"

  chaos_log "killing $label (SIGKILL)"
  hosted_compose kill -s SIGKILL "$service" || hosted_compose kill "$service"
  wait_http_down "$health_url" 45 "$label"

  chaos_log "starting $label"
  hosted_compose start "$service" >/dev/null 2>&1 || true
  wait_http_ok "$health_url" 120 "$label"
}
