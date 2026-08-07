# Live chaos — expected-outcome matrix (WP-113)

Authority: Plan 14 chaos matrix + `docs/WP-113_LIVE_CHAOS.md`.  
Layer: **live** (`docker-compose.hosted.yml` ± local `docker-compose.yml` datastores).  
Gate: `CHAOS_LIVE=1`. Never production.

| Scenario | Fault injection | Expected safe outcome | Automated assert | Manual / staging follow-up |
|---|---|---|---|---|
| `game-kill` | `SIGKILL` game | Restart → `:4001/health` ok; lease surface (`tableLease` / `actorInstanceId`); no dual-writer | Health + lease fields | Mid-hand kill → outbox drain + tip match Postgres |
| `dealer-kill` | `SIGKILL` dealer | Restart → `:4003/health` ok; attest surface; deal calls fail closed while down | Health + service/attest hint | Mid-deal request fails; new commit after reclaim |
| `indexer-restart` | stop indexer, sleep, start | `:4010/health` ok; lag/cursor resume; money upserts idempotent | Health + lag/cursor fields | Confirm no invented vault credits after lag |
| `rpc-stall` | stop indexer + worker (RPC consumers) | No progress during stall; both recover healthy; catch-up idempotent | Both `/health` ok | Blackhole RPC proxy; dual-URL failover is ops config (not automated) |
| `worker-restart` | `SIGKILL` worker | `:4011/health` ok; settle path idempotent | Health ok | Seed settled session → restart → skip / `AlreadySettled` |
| `settlement-stall` | `SIGKILL` verifier + worker | Verifier then worker recover; no double-pay | Both `/health` ok | Mid-submit stall → single Hub settle + vault credit |
| `vrf-stall` | `SIGKILL` worker on VRF path | Worker recovers; fulfill/settle once | Health + mock-VRF env note | Anvil `ENABLE_MOCK_VRF=1` session: single fulfill after kill |
| `redis-kill` | `docker pause mozetto-redis` | Resume → game health ok; multi-replica fencing fails closed during pause | Pause/unpause + PONG + game health | ≥2 game replicas: B cannot steal A’s live lease during pause |
| `db-disconnect` | `docker pause mozetto-postgres` | Resume → DB ready; persist-before-broadcast (unit-proven) | Pause/unpause + pg_isready | No ghost WS events during pause |

## Plan 14 coverage (live)

| Fault | Live status |
|---|---|
| Game actor | Covered (`game-kill`) |
| WebSocket gateway | Partial (same process as game today) |
| Redis | Covered when local redis up (`redis-kill`) |
| Postgres connection | Opt-in (`CHAOS_DB_DISCONNECT=1`) |
| Primary / fallback RPC | Partial consumer stall (`rpc-stall`); dual-URL failover deferred to ops |
| Indexer | Covered (`indexer-restart`) |
| Proof publisher | Deferred (optional `Dockerfile.publisher`; not in hosted compose default) |
| Dealer parent | Covered (`dealer-kill`) |
| Dealer enclave / vsock | Deferred (real AWS Nitro) |
| Groq request | Deferred (agent kill optional; AI mock fallback exists) |
| Attestor | Partial via `settlement-stall` (replay verifier) |
| Settlement submitter | Covered (`worker-restart`, `settlement-stall`) |
| Relayer transaction | Deferred (API relayer keys; not compose-kill) |
| VRF fulfillment | Partial process recovery (`vrf-stall`); full fulfill race = Anvil manual |

## CI honesty

| Path | Default CI |
|---|---|
| `pnpm test:chaos` (unit) | **Yes** |
| `CHAOS_LIVE=1 pnpm test:chaos:live` | **No** — needs Docker + hosted stack + secrets |
