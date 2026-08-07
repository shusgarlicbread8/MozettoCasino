#!/usr/bin/env bash
# Build poker-wasm for Node (WP-035).
# Requires: rustup target wasm32-unknown-unknown, wasm-bindgen-cli (~0.2.100)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

OUT_DIR="${1:-tools/poker-wasm/pkg}"
PROFILE="${WASM_PROFILE:-release}"

rustup target add wasm32-unknown-unknown >/dev/null

if [ "$PROFILE" = "release" ]; then
  cargo build -p poker-wasm --target wasm32-unknown-unknown --release
  WASM_PATH="target/wasm32-unknown-unknown/release/poker_wasm.wasm"
else
  cargo build -p poker-wasm --target wasm32-unknown-unknown
  WASM_PATH="target/wasm32-unknown-unknown/debug/poker_wasm.wasm"
fi

mkdir -p "$OUT_DIR"
wasm-bindgen "$WASM_PATH" \
  --out-dir "$OUT_DIR" \
  --target nodejs \
  --out-name poker_wasm

echo "WP-035 WASM built -> $OUT_DIR"
ls -la "$OUT_DIR"
