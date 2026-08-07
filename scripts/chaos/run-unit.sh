#!/usr/bin/env bash
# WP-101 CI-safe unit chaos (no Docker required).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

if [[ ! -d node_modules ]]; then
  echo "[chaos] node_modules missing — run pnpm install first" >&2
  exit 1
fi

echo "[chaos] running WP-101 unit suite"
# Resolve tsx via workspace package (root does not depend on tsx).
exec pnpm --filter @mozetto/game-server exec tsx "$ROOT/scripts/chaos/unit/run.mjs" "$@"
