# Pinned tool versions (WP-000)

Use these exact versions for local development and CI. Dockerfiles already use **Node 22** + **pnpm 9.15.0**.

| Tool | Version | Pin location |
|------|---------|--------------|
| **Node.js** | `22` (Active LTS line; CI uses `22`) | `.nvmrc`, `.node-version`, root `package.json` `engines` |
| **pnpm** | `9.15.0` | `packageManager` in root `package.json`; Corepack |
| **Foundry** (forge / cast / anvil) | `v1.7.1` | `.foundry-version`; install with `foundryup -i v1.7.1` |
| **Solidity (solc)** | `0.8.24` | `contracts/foundry.toml` |
| **Rust** | `1.85.0` | `rust-toolchain.toml` (not required for V2 E2E) |
| **wasm-bindgen-cli** | `0.2.100` | Must match `crates/poker-wasm` pin; `cargo install wasm-bindgen-cli --version 0.2.100 --locked` |
| **PostgreSQL** | `16` | `docker-compose.yml` service `postgres` |
| **Redis** | `7` | `docker-compose.yml` service `redis` (optional; game-server leases) |
| **Anvil** | Foundry `v1.7.1` binary | chain id **31337**, RPC `http://127.0.0.1:8545` |

## Install hints

```bash
# Node 22 (nvm / fnm / asdf)
nvm install   # reads .nvmrc
corepack enable && corepack prepare pnpm@9.15.0 --activate

# Foundry
curl -L https://foundry.paradigm.xyz | bash
foundryup -i v1.7.1

# Rust (optional until Wave 3)
rustup show   # rust-toolchain.toml selects 1.85.0

# WASM verifier (WP-035)
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.100 --locked
```

## Database

`DATABASE_URL` is **required** for migrations and the running API/game-server.

Options:

1. **Supabase pooler** (typical) — port `6543`, see `.env.example`
2. **Local Docker Postgres** — `docker compose up -d postgres` then use the URL printed by `pnpm bootstrap`

Direct `db.*.supabase.co:5432` is often IPv6-only; prefer the pooler.
