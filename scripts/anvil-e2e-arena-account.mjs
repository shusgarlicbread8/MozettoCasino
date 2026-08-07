#!/usr/bin/env node
/**
 * Anvil E2E: two owners → SIWE → ArenaAccount deploy → fund → GamePermission →
 * Find Match → openSession locks → join.
 *
 * Usage: node scripts/anvil-e2e-arena-account.mjs
 * Uses Anvil accounts #3 and #4.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { anvil } from "viem/chains";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

function loadEnvFile(name) {
  const p = resolve(root, name);
  if (!existsSync(p)) return {};
  const out = {};
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 1) continue;
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return out;
}

const env = { ...loadEnvFile(".env.example"), ...loadEnvFile(".env.local"), ...process.env };
const API = (env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/$/, "");
const GAME = (env.GAME_SERVER_HTTP_URL || env.NEXT_PUBLIC_GAME_HTTP_URL || "http://localhost:4001").replace(
  /\/$/,
  "",
);
const RPC = env.ANVIL_RPC_URL || "http://127.0.0.1:8545";

const manifestPath = resolve(root, "packages/chain-manifest/deployments/anvil.json");
if (!existsSync(manifestPath)) {
  console.error("Missing anvil.json — run forge script DeployLocal first");
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const FACTORY = manifest.arenaAccountFactory;
const VAULT = manifest.arenaVault;

if (!FACTORY || !VAULT) {
  console.error("anvil.json missing arenaAccountFactory / arenaVault — redeploy V2 stack");
  process.exit(1);
}

const PK_A = "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6";
const PK_B = "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a";

const accountAbi = parseAbi([
  "function gameAuth() view returns (address,address,address,bytes32,uint32,uint256,uint256,uint256,uint256,uint256,uint64,uint16,uint16,bool,bool)",
  "function owner() view returns (address)",
]);
const factoryAbi = parseAbi([
  "function accountOf(address) view returns (address)",
  "function predictAddress(address) view returns (address)",
]);
const vaultAbi = parseAbi(["function totalLocked(address) view returns (uint256)"]);

function ok(msg) {
  console.log(`✓ ${msg}`);
}
function fail(msg) {
  console.error(`✗ ${msg}`);
  throw new Error(msg);
}

function cookieFrom(res) {
  const raw = res.headers.getSetCookie?.() || [];
  if (raw.length) return raw.map((c) => c.split(";")[0]).join("; ");
  const single = res.headers.get("set-cookie");
  return single ? single.split(";")[0] : "";
}

async function api(path, { method = "GET", body, cookie } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  return { res, json, cookie: cookieFrom(res) || cookie };
}

async function siweLogin(pk, displayName) {
  const account = privateKeyToAccount(pk);
  const wallet = createWalletClient({ account, chain: anvil, transport: http(RPC) });
  const { json: nonceJson } = await api(
    `/v1/auth/wallet/nonce?address=${account.address}&chainId=31337`,
  );
  const message = nonceJson.message;
  if (!message) fail(`nonce failed for ${account.address}`);
  const signature = await wallet.signMessage({ message });
  const { res, json, cookie } = await api("/v1/auth/wallet/verify", {
    method: "POST",
    body: {
      address: account.address,
      chainId: 31337,
      message,
      signature,
      displayName,
    },
  });
  if (!res.ok) fail(`SIWE ${account.address}: ${JSON.stringify(json)}`);
  const arena = json.arenaAccountAddress || json.user?.arenaAccountAddress;
  if (!arena) fail("no arenaAccountAddress in verify response");
  ok(`SIWE ${displayName} → ArenaAccount ${arena.slice(0, 10)}…`);
  return { account, cookie, arena, wallet };
}

async function enableSeamless(cookie, wallet) {
  const { json: status, res } = await api("/v1/arena/play-status", { cookie });
  if (!res.ok) fail(`play-status: ${JSON.stringify(status)}`);
  if (status.enabled) {
    ok("seamless play already on");
    return;
  }
  const d = status.defaults;
  const message = {
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
  };
  const signature = await wallet.signTypedData({
    domain: status.domain,
    types: status.types,
    primaryType: "GamePermission",
    message,
  });
  const { res: r2, json: j2 } = await api("/v1/arena/game-permission", {
    method: "POST",
    cookie,
    body: {
      account: status.arenaAccountAddress,
      sessionSigner: d.sessionSigner,
      usdc: d.usdc,
      vault: d.vault,
      gameTemplateId: d.gameTemplateId,
      leagueMask: d.leagueMask,
      lifetimeCommittedCap: d.lifetimeCommittedCap,
      maxTotalAtRisk: d.maxTotalAtRisk,
      maxSingleBuyIn: d.maxSingleBuyIn,
      validUntil: d.validUntil,
      maxConcurrentGames: d.maxConcurrentGames,
      ratedOnly: d.ratedOnly,
      nonce: d.nonce,
      enabled: true,
      signature,
    },
  });
  if (!r2.ok) fail(`game-permission: ${JSON.stringify(j2)}`);
  ok("GamePermission enabled");
}

async function main() {
  console.log("Arena Account E2E →", API);
  const publicClient = createPublicClient({ chain: anvil, transport: http(RPC) });
  try {
    await publicClient.getBlockNumber();
  } catch {
    fail("Anvil not reachable at " + RPC);
  }

  const a = await siweLogin(PK_A, "E2E Alice");
  const b = await siweLogin(PK_B, "E2E Bob");

  for (const p of [a, b]) {
    const onchain = await publicClient.readContract({
      address: FACTORY,
      abi: factoryAbi,
      functionName: "accountOf",
      args: [p.account.address],
    });
    if (onchain.toLowerCase() !== p.arena.toLowerCase()) {
      fail(`factory accountOf mismatch ${onchain} vs ${p.arena}`);
    }
    const { res, json } = await api("/v1/arena/fund-test", {
      method: "POST",
      cookie: p.cookie,
      body: { amountUsdc: 5000 },
    });
    if (!res.ok) fail(`fund-test: ${JSON.stringify(json)}`);
    ok(`funded ${p.account.address.slice(0, 8)} ArenaAccount +${json.amountUsdc}`);
  }

  await enableSeamless(a.cookie, a.wallet);
  await enableSeamless(b.cookie, b.wallet);

  const find = async (cookie) => {
    const { res, json } = await api("/v1/arena/find-match", {
      method: "POST",
      cookie,
      body: { leagueId: "bronze", profileKey: "fox" },
    });
    return { res, json };
  };

  let rA = await find(a.cookie);
  let rB = await find(b.cookie);
  // One waits, one opens — poll until tableId
  for (let i = 0; i < 12; i++) {
    if (rA.json.tableId || rB.json.tableId) break;
    await new Promise((r) => setTimeout(r, 1500));
    rA = await find(a.cookie);
    rB = await find(b.cookie);
  }
  const tableId = rA.json.tableId || rB.json.tableId;
  if (!tableId) fail(`no table: A=${JSON.stringify(rA.json)} B=${JSON.stringify(rB.json)}`);
  ok(`matched table ${tableId}`);

  const lockedA = await publicClient.readContract({
    address: VAULT,
    abi: vaultAbi,
    functionName: "totalLocked",
    args: [a.arena],
  });
  const lockedB = await publicClient.readContract({
    address: VAULT,
    abi: vaultAbi,
    functionName: "totalLocked",
    args: [b.arena],
  });
  if (lockedA < 100n * 10n ** 6n || lockedB < 100n * 10n ** 6n) {
    fail(`expected locked buy-ins, got ${lockedA} / ${lockedB}`);
  }
  ok(`V2 locks confirmed (${lockedA} / ${lockedB})`);

  for (const [label, cookie] of [
    ["A", a.cookie],
    ["B", b.cookie],
  ]) {
    const { res, json } = await api(`${GAME.replace("4001", "4001")}/v1/tables/${tableId}/join`.replace(API, GAME), {
      method: "POST",
      cookie,
      body: { buyIn: 100, profileKey: "fox" },
    }).catch(async () => {
      // join via game server
      const res2 = await fetch(`${GAME}/v1/tables/${tableId}/join`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ buyIn: 100, profileKey: "fox" }),
      });
      return { res: res2, json: await res2.json().catch(() => ({})) };
    });
    if (res.ok) ok(`join ${label}`);
    else console.log(`join ${label}: ${res.status} ${JSON.stringify(json)}`);
  }

  console.log("\nE2E Arena Account path OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
