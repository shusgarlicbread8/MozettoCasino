#!/usr/bin/env node
/**
 * Anvil E2E: two fake wallets → SIWE → faucet → InstantPermission → Find Match →
 * join → play an action → leave → (optional) wait for unlock.
 *
 * Usage:
 *   node scripts/anvil-e2e-instant-match.mjs
 *
 * Uses Anvil accounts #3 and #4 (keeps #0 relayer, #2 Instant session signer free).
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
  formatUnits,
  parseAbi,
  maxUint256,
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
const WEB = (env.WEB_ORIGIN || "http://127.0.0.1:3000").replace(/\/$/, "");
const RPC = env.ANVIL_RPC_URL || "http://127.0.0.1:8545";

const manifest = JSON.parse(
  readFileSync(resolve(root, "packages/chain-manifest/deployments/anvil.json"), "utf8"),
);
const USDC = manifest.usdc;
const VAULT = manifest.arenaVault;

const PK_A = "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6";
const PK_B = "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a";
const SESSION_SIGNER_PK =
  env.INSTANT_SESSION_SIGNER_PRIVATE_KEY ||
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";
const RELAYER_PK =
  env.SESSION_RELAYER_PRIVATE_KEY ||
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

const erc20 = parseAbi([
  "function faucet(uint256 amount)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
]);
const vaultAbi = parseAbi([
  "function setInstantPermission(address player,address sessionSigner,uint256 spendCap,uint256 maxSingleBuyIn,uint64 expiresAt,uint256 nonce,bool enabled,bytes signature)",
  "function instantAuthNonce(address player) view returns (uint256)",
  "function remainingInstantSpend(address player) view returns (uint256)",
  "function instantAuth(address player) view returns (address sessionSigner,uint256 spendCap,uint256 spent,uint256 maxSingleBuyIn,uint64 expiresAt,bool enabled)",
  "function totalLocked(address user) view returns (uint256)",
]);

const findings = [];
function ok(msg) {
  console.log(`✓ ${msg}`);
}
function warn(msg) {
  console.log(`⚠ ${msg}`);
  findings.push({ level: "warn", msg });
}
function fail(msg) {
  console.error(`✗ ${msg}`);
  findings.push({ level: "fail", msg });
  throw new Error(msg);
}

function cookieFrom(res) {
  const raw = res.headers.getSetCookie?.() || [];
  if (raw.length) {
    return raw.map((c) => c.split(";")[0]).join("; ");
  }
  const single = res.headers.get("set-cookie");
  if (!single) return "";
  return single
    .split(",")
    .map((p) => p.trim().split(";")[0])
    .filter((p) => p.includes("="))
    .join("; ");
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
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  return { res, data, cookie: cookieFrom(res) || cookie || "" };
}

async function game(path, { method = "GET", body, cookie } = {}) {
  // Always send `{}` on mutating JSON requests — Fastify rejects empty JSON bodies.
  const hasBody = method !== "GET" && method !== "HEAD";
  const res = await fetch(`${GAME}${path}`, {
    method,
    headers: {
      ...(hasBody || body !== undefined ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: hasBody ? JSON.stringify(body ?? {}) : body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

async function siweLogin(account, displayName) {
  const address = account.address.toLowerCase();
  const nonceRes = await api(`/v1/auth/wallet/nonce?address=${address}&chainId=31337`);
  if (!nonceRes.res.ok) fail(`nonce failed: ${JSON.stringify(nonceRes.data)}`);
  const message = nonceRes.data.message;
  const signature = await account.signMessage({ message });
  const verify = await api("/v1/auth/wallet/verify", {
    method: "POST",
    body: { address, chainId: 31337, message, signature, displayName },
  });
  if (!verify.res.ok) fail(`SIWE verify failed for ${address}: ${JSON.stringify(verify.data)}`);
  if (!verify.cookie.includes("mozetto_session")) fail(`No session cookie for ${address}`);
  ok(`SIWE ${displayName} ${address.slice(0, 8)}…`);
  return verify.cookie;
}

async function enableInstant(account, publicClient, relayerWallet) {
  const spendCap = parseUnits("50000", 6);
  const maxSingle = parseUnits("5000", 6);
  const sessionSigner = privateKeyToAccount(SESSION_SIGNER_PK);

  const approveHash = await createWalletClient({
    account,
    chain: anvil,
    transport: http(RPC),
  }).writeContract({
    address: USDC,
    abi: erc20,
    functionName: "approve",
    args: [VAULT, maxUint256],
  });
  await publicClient.waitForTransactionReceipt({ hash: approveHash });

  const nonce = await publicClient.readContract({
    address: VAULT,
    abi: vaultAbi,
    functionName: "instantAuthNonce",
    args: [account.address],
  });
  const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 30 * 24 * 3600);
  const domain = {
    name: "MozettoArenaVault",
    version: "1",
    chainId: 31337,
    verifyingContract: VAULT,
  };
  const types = {
    InstantPermission: [
      { name: "player", type: "address" },
      { name: "sessionSigner", type: "address" },
      { name: "spendCap", type: "uint256" },
      { name: "maxSingleBuyIn", type: "uint256" },
      { name: "expiresAt", type: "uint64" },
      { name: "nonce", type: "uint256" },
      { name: "enabled", type: "bool" },
    ],
  };
  const wallet = createWalletClient({ account, chain: anvil, transport: http(RPC) });
  const signature = await wallet.signTypedData({
    account,
    domain,
    types,
    primaryType: "InstantPermission",
    message: {
      player: account.address,
      sessionSigner: sessionSigner.address,
      spendCap,
      maxSingleBuyIn: maxSingle,
      expiresAt,
      nonce,
      enabled: true,
    },
  });

  const hash = await relayerWallet.writeContract({
    address: VAULT,
    abi: vaultAbi,
    functionName: "setInstantPermission",
    args: [account.address, sessionSigner.address, spendCap, maxSingle, expiresAt, nonce, true, signature],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  ok(`InstantPermission on-chain for ${account.address.slice(0, 8)}…`);
}

async function leaveIfSeated(cookie, label) {
  // Use wallet sessions — never Find Match (that can accidentally open a new table).
  const w = await api("/v1/wallet", { cookie });
  const sessions = (w.data.sessions || []).filter((s) => s.status === "active" && s.table_id);
  for (const s of sessions) {
    const leave = await game(`/v1/tables/${s.table_id}/leave`, { method: "POST", cookie });
    if (leave.res.ok) ok(`${label} left stale table ${s.table_id}`);
    else warn(`${label} leave ${s.table_id}: ${JSON.stringify(leave.data).slice(0, 160)}`);
  }
  return sessions[0]?.table_id ?? null;
}

async function main() {
  console.log("\n=== Anvil E2E Instant Match ===\n");
  console.log("API", API);
  console.log("GAME", GAME);
  console.log("USDC", USDC);
  console.log("VAULT", VAULT);

  if (!(await fetch(`${API}/health`)).ok) fail("API not healthy");
  ok("API healthy");
  if (!(await fetch(`${GAME}/health`)).ok) fail("Game-server not healthy");
  ok("Game-server healthy");

  const alice = privateKeyToAccount(PK_A);
  const bob = privateKeyToAccount(PK_B);
  const relayer = privateKeyToAccount(RELAYER_PK);
  const publicClient = createPublicClient({ chain: anvil, transport: http(RPC) });
  const relayerWallet = createWalletClient({ account: relayer, chain: anvil, transport: http(RPC) });

  for (const addr of [alice.address, bob.address]) {
    await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "anvil_setBalance",
        params: [addr, "0x56BC75E2D63100000"],
      }),
    });
  }

  for (const [label, account] of [
    ["Alice", alice],
    ["Bob", bob],
  ]) {
    const w = createWalletClient({ account, chain: anvil, transport: http(RPC) });
    const hash = await w.writeContract({
      address: USDC,
      abi: erc20,
      functionName: "faucet",
      args: [parseUnits("20000", 6)],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    const bal = await publicClient.readContract({
      address: USDC,
      abi: erc20,
      functionName: "balanceOf",
      args: [account.address],
    });
    if (bal < parseUnits("10000", 6)) fail(`${label} faucet failed`);
    ok(`${label} faucet ${formatUnits(bal, 6)} mUSDC`);
  }

  const cookieA = await siweLogin(alice, "E2E Alice");
  const cookieB = await siweLogin(bob, "E2E Bob");

  const statusA = await api("/v1/arena/instant-status", { cookie: cookieA });
  if (!statusA.res.ok) fail(`instant-status: ${JSON.stringify(statusA.data)}`);
  if (!statusA.data.sessionSigner) fail("instant-status missing sessionSigner");
  ok(`instant-status sessionSigner=${String(statusA.data.sessionSigner).slice(0, 10)}…`);

  await enableInstant(alice, publicClient, relayerWallet);
  await enableInstant(bob, publicClient, relayerWallet);

  const statusA2 = await api("/v1/arena/instant-status", { cookie: cookieA });
  if (!statusA2.data.enabled) warn(`instant-status.enabled=false after on-chain auth`);
  else ok("Alice Instant enabled per API");

  const nw = await api("/v1/wallet/net-worth?range=1d", { cookie: cookieA });
  if (!nw.res.ok) fail(`net-worth failed: ${JSON.stringify(nw.data)}`);
  ok(`net-worth points=${(nw.data.points || []).length}`);

  // Clear sticky seats from prior runs
  await leaveIfSeated(cookieA, "Alice");
  await leaveIfSeated(cookieB, "Bob");
  await new Promise((r) => setTimeout(r, 500));

  const lockedBeforeA = await publicClient.readContract({
    address: VAULT,
    abi: vaultAbi,
    functionName: "totalLocked",
    args: [alice.address],
  });

  const fmA1 = await api("/v1/arena/find-match", {
    method: "POST",
    cookie: cookieA,
    body: { leagueId: "bronze", profileKey: "fox" },
  });
  console.log("Alice find-match #1", fmA1.res.status, JSON.stringify(fmA1.data).slice(0, 240));
  if (fmA1.data.status === "waiting") ok("Alice queued waiting for opponent");
  else if (fmA1.data.alreadySeated || fmA1.data.joined) {
    warn("Alice still sticky-seated after leave — sticky-table fix may need game-server restart");
  } else if (fmA1.data.error) {
    fail(`Alice find-match failed: ${JSON.stringify(fmA1.data)}`);
  }

  const fmB = await api("/v1/arena/find-match", {
    method: "POST",
    cookie: cookieB,
    body: { leagueId: "bronze", profileKey: "shark" },
  });
  console.log("Bob find-match", fmB.res.status, JSON.stringify(fmB.data).slice(0, 320));
  if (!fmB.res.ok) fail(`Bob find-match failed: ${JSON.stringify(fmB.data)}`);

  let tid = fmB.data.tableId;
  let joinedB = Boolean(fmB.data.joined || fmB.data.alreadySeated);
  let joinedA = false;

  if (fmB.data.created) ok("Bob paired + openSession created a new table");
  else if (tid) ok(`Bob returned to table ${tid}`);

  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline && (!joinedA || !joinedB || !tid)) {
    const again = await api("/v1/arena/find-match", {
      method: "POST",
      cookie: cookieA,
      body: { leagueId: "bronze", profileKey: "fox" },
    });
    if (again.data.tableId) tid = again.data.tableId;
    if (again.data.joined || again.data.alreadySeated) joinedA = true;
    console.log("Alice poll", again.res.status, JSON.stringify(again.data).slice(0, 220));

    if (!joinedB && tid) {
      const j = await game(`/v1/tables/${tid}/join`, {
        method: "POST",
        cookie: cookieB,
        body: { buyIn: fmB.data.buyIn || 100 },
      });
      if (j.res.ok || j.data.alreadySeated) {
        joinedB = true;
        ok(`Bob joined seat=${j.data.seatIndex}`);
      } else {
        console.log("Bob join pending", j.res.status, JSON.stringify(j.data).slice(0, 200));
      }
    }
    if (!joinedA || !joinedB) await new Promise((r) => setTimeout(r, 1500));
  }

  if (!tid) fail("Missing tableId after pairing");
  if (!joinedA || !joinedB) fail(`Join incomplete Alice=${joinedA} Bob=${joinedB}`);
  ok(`Both seated at ${tid}`);

  const lockedA = await publicClient.readContract({
    address: VAULT,
    abi: vaultAbi,
    functionName: "totalLocked",
    args: [alice.address],
  });
  const lockedB = await publicClient.readContract({
    address: VAULT,
    abi: vaultAbi,
    functionName: "totalLocked",
    args: [bob.address],
  });
  console.log("Locked Alice", formatUnits(lockedA, 6), "Bob", formatUnits(lockedB, 6));
  if (lockedA >= parseUnits("100", 6) && lockedB >= parseUnits("100", 6)) {
    ok("Both players have on-chain locked buy-ins (≥100)");
  } else {
    warn("Expected both players locked ≥100 after openSession");
  }

  // Table status API
  let snap = null;
  for (let i = 0; i < 40; i++) {
    const st = await game(`/v1/tables/${tid}`);
    if (!st.res.ok) {
      warn(`GET /v1/tables/:id → ${st.res.status} ${JSON.stringify(st.data).slice(0, 120)}`);
      break;
    }
    snap = st.data;
    if (snap.street && snap.street !== "waiting" && snap.actingIndex != null) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (snap?.tableId) {
    ok(`Table status street=${snap.street} seated=${snap.seated?.length ?? 0} acting=${snap.actingIndex}`);
  } else {
    warn("No usable table status snapshot");
  }

  // Without a WebSocket client, seats are AI-controlled (HUMAN_PLAY + isBotSeat).
  // Assert the engine advances instead of HTTP human actions.
  const handAtStart = snap?.handNumber ?? 0;
  const streetAtStart = snap?.street ?? "waiting";
  let advanced = false;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const st = await game(`/v1/tables/${tid}`);
    if (!st.res.ok) break;
    snap = st.data;
    if (
      (snap.handNumber ?? 0) > handAtStart ||
      (snap.street && snap.street !== streetAtStart) ||
      (snap.pot ?? 0) > 0
    ) {
      advanced = true;
      break;
    }
  }
  if (advanced) ok(`Engine advanced street=${snap.street} hand=#${snap.handNumber} pot=${snap.pot}`);
  else warn(`Engine did not advance from street=${streetAtStart} hand=#${handAtStart}`);

  // Leave both — should unstick matchmaking and queue settlement
  for (const [label, cookie] of [
    ["Alice", cookieA],
    ["Bob", cookieB],
  ]) {
    const leave = await game(`/v1/tables/${tid}/leave`, { method: "POST", cookie });
    if (leave.res.ok) ok(`${label} left table`);
    else warn(`${label} leave failed: ${JSON.stringify(leave.data).slice(0, 160)}`);
  }

  // After leave, Find Match should queue again (not sticky redirect)
  const fmFresh = await api("/v1/arena/find-match", {
    method: "POST",
    cookie: cookieA,
    body: { leagueId: "bronze", profileKey: "fox" },
  });
  if (fmFresh.data.status === "waiting") ok("Post-leave Find Match queues cleanly (no sticky seat)");
  else if (fmFresh.data.tableId === tid) warn("Sticky seat still returns old table after leave");
  else ok(`Post-leave Find Match → ${JSON.stringify(fmFresh.data).slice(0, 160)}`);

  // UI smoke
  for (const path of ["/", "/poker", "/wallet", "/wallet/test-musdc", "/home"]) {
    const r = await fetch(`${WEB}${path}`);
    if (r.ok || r.status === 307 || r.status === 308) ok(`UI ${path} → ${r.status}`);
    else warn(`UI ${path} → ${r.status}`);
  }

  console.log("\nLocked before Alice", formatUnits(lockedBeforeA, 6));
  console.log("\n=== Findings ===");
  if (!findings.length) console.log("No warnings/failures recorded.");
  for (const f of findings) console.log(`[${f.level}] ${f.msg}`);

  if (findings.some((f) => f.level === "fail")) process.exit(1);
  console.log("\nE2E Instant match script finished.");
}

main().catch((e) => {
  console.error("\nE2E failed:", e.message);
  process.exit(1);
});
