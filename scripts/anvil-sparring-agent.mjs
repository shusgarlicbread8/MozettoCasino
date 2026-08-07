#!/usr/bin/env node
/**
 * Anvil sparring agent — a real counterparty so a solo developer can reach a
 * live ranked match locally.
 *
 * This is NOT a house bot and NOT a shortcut around custody. It is an ordinary
 * player that happens to be driven by a script: it authenticates over SIWE,
 * deploys and funds its own ArenaAccount, grants its own GamePermission, and
 * queues a signed SeatTicket into the same matchmaking pool as everyone else.
 * Every transaction it makes is a real Anvil transaction, and the match it
 * plays settles through the same SettlementHub path as a human-vs-human match.
 * Its seat is played by agent-runtime, exactly like the opposing seat.
 *
 * Hard-gated to chainId 31337. It refuses to run against any other chain, so
 * it can never become a phantom opponent on Sepolia or mainnet.
 *
 *   node scripts/anvil-sparring-agent.mjs              # watch pools, join when someone waits
 *   node scripts/anvil-sparring-agent.mjs --seek       # queue now and stay until seated
 *   node scripts/anvil-sparring-agent.mjs --once       # queue once and exit
 *   node scripts/anvil-sparring-agent.mjs --league gold
 *   node scripts/anvil-sparring-agent.mjs --format classic   # Poker Classic 6-max
 */

import { createPublicClient, createWalletClient, http, keccak256, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ANVIL_CHAIN_ID = 31337;

function loadEnvLocal() {
  const env = { ...process.env };
  try {
    for (const line of readFileSync(join(ROOT, ".env.local"), "utf8").split("\n")) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!m) continue;
      if (env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* .env.local is optional */
  }
  return env;
}

const env = loadEnvLocal();
const argv = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const ONCE = argv.includes("--once");
/** Queue immediately instead of waiting for someone else to appear in the pool. */
const SEEK = argv.includes("--seek");
const RPC = env.ANVIL_RPC_URL || "http://127.0.0.1:8545";
const API = (env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/$/, "");
const LEAGUE = argOf("league", "bronze");
/** "hu" (Texas Hold'em) or "classic" (Poker Classic 6-max). */
const FORMAT = argOf("format", "hu") === "classic" ? "classic" : "hu";
const PROFILE_KEY = argOf("profile", "machine");
const POLL_MS = Number(argOf("poll", "3000"));
/** Leave a table after this long with no opponent, so we re-enter matchmaking. */
const LONELY_MS = Number(argOf("lonely", "30000"));
const GAME_HTTP = (env.NEXT_PUBLIC_GAME_HTTP_URL || "http://localhost:4001").replace(/\/$/, "");
/** Anvil #9 — unused by the relayer, session signer, or any attestor role. */
const SPARRING_PK =
  env.SPARRING_PRIVATE_KEY || "0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6";

const account = privateKeyToAccount(SPARRING_PK);
const publicClient = createPublicClient({ chain: foundry, transport: http(RPC) });
const wallet = createWalletClient({ account, chain: foundry, transport: http(RPC) });

let cookie = null;

function log(...args) {
  console.log(`[sparring ${account.address.slice(0, 8)}]`, ...args);
}

async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  let json = {};
  try {
    json = await res.json();
  } catch {
    /* empty body */
  }
  return { res, json };
}

/** Refuse to run anywhere but Anvil. */
async function assertAnvil() {
  const id = await publicClient.getChainId();
  if (id !== ANVIL_CHAIN_ID) {
    throw new Error(
      `sparring agent is Anvil-only — RPC ${RPC} reports chainId ${id}, refusing to queue a scripted opponent`,
    );
  }
  log(`chain ${id} @ ${RPC}`);
}

async function login() {
  const { json: nonce } = await api(
    `/v1/auth/wallet/nonce?address=${account.address}&chainId=${ANVIL_CHAIN_ID}`,
  );
  if (!nonce.message) throw new Error(`SIWE nonce failed: ${JSON.stringify(nonce)}`);
  const signature = await wallet.signMessage({ message: nonce.message });
  const { res, json } = await api("/v1/auth/wallet/verify", {
    method: "POST",
    body: {
      address: account.address.toLowerCase(),
      chainId: ANVIL_CHAIN_ID,
      message: nonce.message,
      signature,
      displayName: "Sparring Partner",
    },
  });
  if (!res.ok) throw new Error(`SIWE verify failed: ${JSON.stringify(json)}`);
  log("authenticated");
}

/** Mint + deploy + fund the ArenaAccount through the same routes the web app uses. */
async function ensureFunded(buyIn) {
  const { res, json } = await api("/v1/arena/fund-test", {
    method: "POST",
    body: { amountUsdc: Math.max(5000, buyIn * 20) },
  });
  if (!res.ok) throw new Error(`fund-test failed: ${JSON.stringify(json)}`);
  log("arena account funded");
}

/** Grant this account's own GamePermission — signed by its own owner key. */
async function ensureSeamlessPlay() {
  const { res, json: status } = await api("/v1/arena/play-status");
  if (!res.ok) throw new Error(`play-status failed: ${JSON.stringify(status)}`);
  if (status.enabled) {
    log("seamless play already enabled");
    return;
  }
  const d = status.defaults;
  const signature = await wallet.signTypedData({
    domain: status.domain,
    types: status.types,
    primaryType: "GamePermission",
    message: {
      account: status.arenaAccountAddress,
      sessionSigner: d.sessionSigner,
      usdc: d.usdc,
      vault: d.vault,
      gameTemplateId: d.gameTemplateId,
      leagueMask: d.leagueMask,
      lifetimeCommittedCap: BigInt(d.lifetimeCommittedCap),
      maxTotalAtRisk: BigInt(d.maxTotalAtRisk),
      maxSingleBuyIn: BigInt(d.maxSingleBuyIn),
      validUntil: BigInt(d.validUntil),
      maxConcurrentGames: d.maxConcurrentGames,
      ratedOnly: d.ratedOnly,
      nonce: BigInt(d.nonce),
      enabled: true,
    },
  });
  const { res: r2, json: j2 } = await api("/v1/arena/game-permission", {
    method: "POST",
    body: { ...d, account: status.arenaAccountAddress, enabled: true, signature },
  });
  if (!r2.ok) throw new Error(`game-permission failed: ${JSON.stringify(j2)}`);
  log("seamless play enabled");
}

const poolFor = (leagueId) => keccak256(toBytes(`mozetto:pool:${ANVIL_CHAIN_ID}:${leagueId}`));

const lobbyPath = () => (FORMAT === "classic" ? "/v1/arena/classic" : "/v1/arena");
const findPath = () =>
  FORMAT === "classic" ? "/v1/arena/classic/find-match" : "/v1/arena/find-match";

/**
 * Is anyone actually waiting for an opponent? Two signals, because the two
 * matchmaking modes leave a waiting player in different places:
 *  - pair-seal (SEAL_AND_FUND_V3=1): a queued ticket sitting in the pool;
 *  - seat-first (default): already seated on a table that isn't full yet.
 * Watching only the pool misses every seat-first player.
 */
async function someoneIsWaiting(leagueId) {
  const { json: pools } = await api("/v1/matchmaking/pools");
  const pool = poolFor(leagueId).toLowerCase();
  const queued = (pools.pools ?? []).some(
    (p) => String(p.pool).toLowerCase() === pool && p.status === "queued" && Number(p.tickets) > 0,
  );
  if (queued) return true;

  const { res, json: lobby } = await api(lobbyPath());
  if (!res.ok) return false;
  const league = (lobby.leagues ?? []).find((l) => l.id === leagueId);
  return Boolean(league && Number(league.seated) > 0);
}

async function findMatch(leagueId) {
  const { res, json } = await api(findPath(), {
    method: "POST",
    body: { leagueId, profileKey: PROFILE_KEY },
  });
  if (!res.ok) throw new Error(`find-match failed: ${JSON.stringify(json)}`);
  return json;
}

/** How many players the engine currently sees at this table. */
async function seatedCount(tableId) {
  try {
    const r = await fetch(`${GAME_HTTP}/v1/tables/${tableId}`);
    if (!r.ok) return null;
    const j = await r.json();
    return Array.isArray(j.seated) ? j.seated.length : null;
  } catch {
    return null;
  }
}

async function leaveTable(tableId) {
  const { res, json } = await api(`/v1/tables/${tableId}/leave`, { method: "POST" });
  if (!res.ok) throw new Error(`leave failed: ${JSON.stringify(json)}`);
}

async function main() {
  if (argv.includes("-h") || argv.includes("--help")) {
    console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0]);
    return;
  }

  await assertAnvil();
  await login();
  await ensureFunded(LEAGUE === "bronze" ? 100 : 500);
  await ensureSeamlessPlay();

  if (ONCE) {
    const r = await findMatch(LEAGUE);
    log("queued:", r.status ?? (r.tableId ? "seated" : "unknown"), r.tableId ?? r.message ?? "");
    return;
  }

  log(`watching ${FORMAT}/${LEAGUE} every ${POLL_MS}ms — ctrl-c to stop`);
  // idle → queued → seated. Once queued we keep calling find-match regardless
  // of pool occupancy: pair-sealing and *taking the seat* are separate calls,
  // so a single call that answers "waiting" never puts us at the table.
  let phase = "idle";
  let seatedTable = null;
  let aloneSince = null;

  for (;;) {
    try {
      // Alone at a table that cannot deal? Leave, exactly as a player would.
      // Staying put is what pins an account to a dead table: find-match keeps
      // returning the seat you still hold, so you never re-enter matchmaking.
      if (phase === "seated" && seatedTable) {
        const n = await seatedCount(seatedTable);
        if (n != null && n < 2) {
          aloneSince ??= Date.now();
          if (Date.now() - aloneSince > LONELY_MS) {
            log(`alone at ${seatedTable} for ${Math.round(LONELY_MS / 1000)}s — leaving`);
            await leaveTable(seatedTable).catch((e) => log("leave error:", e.message));
            phase = "idle";
            seatedTable = null;
            aloneSince = null;
          }
        } else if (n != null) {
          aloneSince = null;
        }
      }

      // --seek initiates like a human clicking Find Match; the default is
      // reactive, so the agent never holds custody exposure unless somebody
      // is actually waiting for an opponent.
      const shouldCall = phase !== "idle" || SEEK || (await someoneIsWaiting(LEAGUE));
      if (shouldCall) {
        const r = await findMatch(LEAGUE);
        if (r.tableId) {
          if (phase !== "seated" || seatedTable !== r.tableId) {
            log(`seated at ${r.tableId} (session ${r.sessionId ?? "pending"})`);
            aloneSince = null;
          }
          phase = "seated";
          seatedTable = r.tableId;
        } else if (phase === "seated") {
          log(`match ${seatedTable} finished — back to the pool`);
          phase = "idle";
          seatedTable = null;
        } else {
          if (phase === "idle") log(`queued — ${r.message ?? r.status ?? "waiting"}`);
          phase = "queued";
        }
      }
    } catch (e) {
      log("error:", e instanceof Error ? e.message : e);
      // A failed find-match leaves our ticket in an unknown state; re-enter
      // through the pool check rather than hammering a broken match.
      phase = "idle";
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main().catch((e) => {
  console.error("[sparring] fatal:", e instanceof Error ? e.message : e);
  process.exit(1);
});
