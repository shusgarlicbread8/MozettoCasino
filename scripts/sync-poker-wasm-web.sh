#!/usr/bin/env bash
# WP-090 — Build poker-wasm for the browser and copy into apps/web/public/poker-wasm.
# Optional: public Verify Game page loads /poker-wasm/poker_wasm.js when present.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

OUT_DIR="${1:-apps/web/public/poker-wasm}"
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
tmp="$(mktemp -d)"
wasm-bindgen "$WASM_PATH" \
  --out-dir "$tmp" \
  --target web \
  --out-name poker_wasm

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"
cp -R "$tmp"/* "$OUT_DIR"/
rm -rf "$tmp"

# Also keep Node target for CI / pnpm test:poker-wasm
bash "$ROOT/scripts/build-poker-wasm.sh" tools/poker-wasm/pkg

echo "WP-090 browser WASM -> $OUT_DIR"
ls -la "$OUT_DIR"
