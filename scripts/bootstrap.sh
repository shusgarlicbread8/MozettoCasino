#!/usr/bin/env bash
# Single fresh-clone → local stack bootstrap (WP-000).
#
# Usage:
#   pnpm bootstrap
#   ./scripts/bootstrap.sh
#   ./scripts/bootstrap.sh --reset          # fresh Anvil deploy
#   ./scripts/bootstrap.sh --docker-db      # start compose Postgres/Redis; use local DATABASE_URL if unset
#   ./scripts/bootstrap.sh --no-start       # install + migrate + (optional) Anvil only
#   ./scripts/bootstrap.sh --check          # prerequisites only
#
# Requires DATABASE_URL for migrate / API / E2E (Supabase pooler or local docker).
# Does NOT overwrite secrets already present in .env.local.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export PATH="${HOME}/.foundry/bin:${PATH}"

DO_START=1
DO_RESET=0
DO_DOCKER_DB=0
CHECK_ONLY=0

for arg in "$@"; do
  case "$arg" in
    --no-start) DO_START=0 ;;
    --reset) DO_RESET=1 ;;
    --docker-db) DO_DOCKER_DB=1 ;;
    --check) CHECK_ONLY=1 ;;
    -h|--help)
      sed -n '2,16p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown arg: $arg" >&2
      exit 1
      ;;
  esac
done

echo "╔══════════════════════════════════════════════╗"
echo "║  Mozetto bootstrap (V2 reproducible local) ║"
echo "╚══════════════════════════════════════════════╝"
echo

bash "$ROOT/scripts/check-prereqs.sh"
if [[ "$CHECK_ONLY" == "1" ]]; then
  exit 0
fi

echo
echo "→ Installing dependencies (pnpm install --frozen-lockfile)…"
pnpm install --frozen-lockfile

# --- Env prep (never clobber existing .env.local) ---
if [[ ! -f .env.local ]]; then
  echo "→ Creating .env.local from .env.example (edit secrets before production use)…"
  cp .env.example .env.local
  # Sensible local Anvil defaults for a fresh clone
  node <<'NODE'
const fs = require("fs");
const path = ".env.local";
let env = fs.readFileSync(path, "utf8");
const set = (key, val) => {
  const re = new RegExp(`^${key}=.*$`, "m");
  if (re.test(env)) env = env.replace(re, `${key}=${val}`);
  else env += `\n${key}=${val}\n`;
};
const anvilKeys = {
  MOZETTO_CHAIN_ENV: "anvil",
  NEXT_PUBLIC_CHAIN_ENV: "anvil",
  CHAIN_ID: "31337",
  ENABLE_MOCK_VRF: "1",
  // Anvil account #0
  SESSION_RELAYER_PRIVATE_KEY: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  SETTLEMENT_PRIVATE_KEY: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  // Anvil #5 — seamless session signer (must differ from relayer)
  INSTANT_SESSION_SIGNER_PRIVATE_KEY: "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
  // Attestors (Anvil #1, #7, #8) — must be distinct
  GAME_ATTESTOR_PRIVATE_KEY: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  REPLAY_ATTESTOR_PRIVATE_KEY: "0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356",
  DEALER_ATTESTOR_PRIVATE_KEY: "0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97",
  SESSION_SECRET: "local-dev-session-secret-change-me",
  ADMIN_TOKEN: "local-dev-admin-token-change-me",
};
for (const [k, v] of Object.entries(anvilKeys)) set(k, v);
fs.writeFileSync(path, env);
console.log("Seeded Anvil defaults into new .env.local");
NODE
else
  echo "→ .env.local exists — leaving secrets untouched"
fi

if [[ "$DO_DOCKER_DB" == "1" ]]; then
  if ! command -v docker >/dev/null 2>&1; then
    echo "ERROR: --docker-db requires Docker" >&2
    exit 1
  fi
  echo "→ Starting Docker Postgres 16 + Redis 7…"
  docker compose up -d
  for _ in $(seq 1 40); do
    if docker compose exec -T postgres pg_isready -U mozetto -d mozetto >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
  # Only inject local DATABASE_URL if missing or still a placeholder
  node <<'NODE'
const fs = require("fs");
const path = ".env.local";
let env = fs.readFileSync(path, "utf8");
const get = (key) => {
  const m = env.match(new RegExp(`^${key}=(.*)$`, "m"));
  return m ? m[1].trim() : "";
};
const set = (key, val) => {
  const re = new RegExp(`^${key}=.*$`, "m");
  if (re.test(env)) env = env.replace(re, `${key}=${val}`);
  else env += `\n${key}=${val}\n`;
};
const db = get("DATABASE_URL");
const placeholder = !db || /YOUR_PROJECT|YOUR_PASSWORD|changeme/i.test(db);
if (placeholder) {
  set("DATABASE_URL", "postgresql://mozetto:mozetto@127.0.0.1:5432/mozetto");
  set("DATABASE_URL_DIRECT", "postgresql://mozetto:mozetto@127.0.0.1:5432/mozetto");
  console.log("Set DATABASE_URL to local docker postgres");
} else {
  console.log("DATABASE_URL already set — not overwritten by --docker-db");
}
const redis = get("REDIS_URL");
if (!redis) {
  set("REDIS_URL", "redis://127.0.0.1:6379");
  console.log("Set REDIS_URL=redis://127.0.0.1:6379");
}
fs.writeFileSync(path, env);
NODE
fi

set -a
# shellcheck disable=SC1091
source .env.local
set +a

if [[ -z "${DATABASE_URL:-}" ]] || [[ "$DATABASE_URL" == *"YOUR_PROJECT"* ]] || [[ "$DATABASE_URL" == *"YOUR_PASSWORD"* ]]; then
  echo
  echo "WARNING: DATABASE_URL is missing or still a placeholder."
  echo "  Option A: paste a Supabase pooler URL into .env.local (port 6543)"
  echo "  Option B: re-run with  ./scripts/bootstrap.sh --docker-db"
  echo "Migrations and E2E will fail until DATABASE_URL is real."
  echo
  DB_READY=0
else
  DB_READY=1
fi

if [[ "$DB_READY" == "1" ]]; then
  echo "→ Applying migrations 001–016…"
  pnpm db:migrate
else
  echo "→ Skipping migrate (no DATABASE_URL)"
fi

if [[ "$DO_RESET" == "1" ]]; then
  echo "→ Resetting Anvil + redeploying contracts…"
  bash "$ROOT/scripts/reset-local.sh"
elif ! curl -sf -X POST "${ANVIL_RPC_URL:-http://127.0.0.1:8545}" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' >/dev/null 2>&1; then
  echo "→ Anvil not running — starting + deploying…"
  bash "$ROOT/scripts/reset-local.sh"
else
  echo "→ Anvil already up (use --reset for a clean chain)"
fi

if [[ "$DO_START" == "1" ]]; then
  if [[ "$DB_READY" != "1" ]]; then
    echo "→ Skipping service start (DATABASE_URL required). Anvil may still be ready."
  else
    echo "→ Starting local services via scripts/start-local.sh…"
    # start-local re-sources env and migrates again (idempotent)
    bash "$ROOT/scripts/start-local.sh"
  fi
else
  echo "→ --no-start: not launching API/web services"
fi

echo
bash "$ROOT/scripts/readiness-report.sh"

echo
echo "Fresh-clone sequence (documented):"
echo "  1. pnpm bootstrap --docker-db --reset     # or set DATABASE_URL in .env.local first"
echo "  2. pnpm readiness"
echo "  3. pnpm e2e:arena-account"
echo
echo "See README.md and docs/TOOL_VERSIONS.md"
