#!/usr/bin/env bash
# WP-103 — Print Verify Game + watchtower CLI pointers for Stage A/B ops packs.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

API="${TESTNET_API_URL:-${NEXT_PUBLIC_API_URL:-http://localhost:4000}}"
WEB="${TESTNET_WEB_URL:-${NEXT_PUBLIC_WEB_URL:-http://localhost:3000}}"

cat <<EOF
== WP-103 verify / watchtower pointers ==
Network: Base Sepolia (84532) — test assets only; no real-value promises.
Manifest: packages/chain-manifest/deployments/baseSepolia.json
Program:  docs/WP-103_PUBLIC_TESTNET_PROGRAM.md

## Public Verify Game (WP-090)
  UI:     ${WEB%/}/verify
  API:    ${API%/}/v1/verify/resolve?q=<sessionOrHandOrDigest>
  Session:${API%/}/v1/verify/session/<sessionId>
  Hand:   ${API%/}/v1/verify/hand/<handId>
  Docs:   docs/WP-090_VERIFY_GAME.md

## Local / CLI verifiers (no operator keys)
  # Offline watchtower health (vectors)
  pnpm watchtower
  pnpm watchtower -- --quiet
  pnpm watchtower -- --package path/to/public-package.json

  # Randomness golden / openings
  pnpm verify:randomness

  # Poker replay (fixtures / golden events)
  pnpm test:poker-replay
  cargo run -q -p poker-replay -- verify-events --golden 03

## Stage A gate / health
  pnpm testnet:stage-a-gate
  pnpm testnet:health

## Pause
  scripts/testnet/PAUSE_RUNBOOK.md

EOF
