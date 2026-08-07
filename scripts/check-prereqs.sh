#!/usr/bin/env bash
# Check pinned toolchain versions (WP-000). Exit non-zero on hard failures.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PIN_NODE="$(tr -d '[:space:]' < .nvmrc)"
PIN_PNPM="9.15.0"
PIN_FOUNDRY="$(tr -d '[:space:]' < .foundry-version)"
FAIL=0
WARN=0

note() { printf '  %-12s %s\n' "$1" "$2"; }
fail() { note "$1" "FAIL: $2"; FAIL=1; }
warn() { note "$1" "WARN: $2"; WARN=1; }
ok() { note "$1" "ok — $2"; }

echo "=== Mozetto prerequisite check ==="
echo "Pinned: Node ${PIN_NODE} · pnpm ${PIN_PNPM} · Foundry ${PIN_FOUNDRY}"
echo

if ! command -v node >/dev/null 2>&1; then
  fail "node" "not installed (need Node ${PIN_NODE}.x)"
else
  MAJOR="$(node -p "process.versions.node.split('.')[0]")"
  FULL="$(node -v)"
  if [[ "$MAJOR" != "$PIN_NODE" ]]; then
    warn "node" "found ${FULL}; pin is ${PIN_NODE}.x (Docker/CI use 22)"
  else
    ok "node" "$FULL"
  fi
fi

if ! command -v pnpm >/dev/null 2>&1; then
  fail "pnpm" "not installed (need ${PIN_PNPM}; try: corepack enable && corepack prepare pnpm@${PIN_PNPM} --activate)"
else
  PV="$(pnpm -v)"
  if [[ "$PV" != "$PIN_PNPM" ]]; then
    warn "pnpm" "found ${PV}; pin is ${PIN_PNPM}"
  else
    ok "pnpm" "$PV"
  fi
fi

export PATH="${HOME}/.foundry/bin:${PATH}"
if ! command -v forge >/dev/null 2>&1 || ! command -v anvil >/dev/null 2>&1; then
  fail "foundry" "forge/anvil missing (install: foundryup -i ${PIN_FOUNDRY})"
else
  FV="$(forge --version 2>/dev/null | head -1 || true)"
  ok "foundry" "$FV"
  if ! echo "$FV" | grep -q "1.7.1"; then
    warn "foundry" "expected ${PIN_FOUNDRY}; foundryup -i ${PIN_FOUNDRY}"
  fi
fi

if command -v docker >/dev/null 2>&1; then
  ok "docker" "$(docker --version | head -1)"
else
  warn "docker" "optional — needed for docker compose postgres/redis"
fi

if command -v rustc >/dev/null 2>&1; then
  ok "rustc" "$(rustc --version) (optional for V2 E2E)"
else
  warn "rustc" "optional until Wave 3 (rust-toolchain.toml pins 1.85.0)"
fi

echo
if [[ "$FAIL" -ne 0 ]]; then
  echo "Prerequisites failed. See docs/TOOL_VERSIONS.md"
  exit 1
fi
if [[ "$WARN" -ne 0 ]]; then
  echo "Prerequisites OK with warnings."
else
  echo "Prerequisites OK."
fi
