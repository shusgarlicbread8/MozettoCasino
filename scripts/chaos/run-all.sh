#!/usr/bin/env bash
# WP-101 entrypoint: always unit; live only when CHAOS_LIVE=1.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

bash "$SCRIPT_DIR/run-unit.sh" "$@"

if [[ "${CHAOS_LIVE:-0}" == "1" ]]; then
  echo "[chaos] CHAOS_LIVE=1 — running docker-compose live scenarios"
  bash "$SCRIPT_DIR/run-live.sh" all
else
  echo "[chaos] skipping live docker scenarios (set CHAOS_LIVE=1 when hosted stack is up)"
fi
