#!/usr/bin/env bash
# Shared helpers for Mozetto WP-101 chaos scripts.
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

require_hosted_stack() {
  require_docker
  if [[ ! -f "$HOSTED_COMPOSE" ]]; then
    chaos_fail "missing $HOSTED_COMPOSE"
  fi
  if ! http_ok "$GAME_HEALTH_URL" && ! http_ok "$API_HEALTH_URL"; then
    chaos_warn "hosted stack does not look up (game/api health failed)"
    chaos_warn "start with: docker compose -f docker-compose.hosted.yml --env-file .env.hosted up -d --build"
    chaos_fail "live chaos requires a running hosted stack (see docs/WP-101_CHAOS_SUITE.md)"
  fi
}

assert_json_field_present() {
  local json="$1"
  local field="$2"
  if ! printf '%s' "$json" | grep -q "\"$field\""; then
    chaos_fail "expected JSON field '$field' in: $json"
  fi
}
