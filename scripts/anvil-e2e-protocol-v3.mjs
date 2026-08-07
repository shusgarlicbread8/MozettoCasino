#!/usr/bin/env node
/**
 * WP-100 — Full Anvil protocol E2E orchestrator (Protocol V3 as far as implementable).
 *
 * Composes existing smoke/E2E pieces and runs an on-chain ArenaAccount lifecycle:
 *   mint → fund ArenaAccounts → GamePermission → lock (openSession) → lifecycle seal
 *   → mock VRF + decks → (hands GAP) → proof batch → settle → rake → withdraw
 *
 * Usage:
 *   node scripts/anvil-e2e-protocol-v3.mjs
 *   node scripts/anvil-e2e-protocol-v3.mjs --redeploy
 *   node scripts/anvil-e2e-protocol-v3.mjs --with-api
 *   node scripts/anvil-e2e-protocol-v3.mjs --with-instant
 *   bash scripts/anvil-e2e-protocol-v3.sh --redeploy
 *
 * Exit 0 only when no FAIL stages (GAP/SKIP allowed).
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  parseUnits,
  formatUnits,
  keccak256,
  toBytes,
  getAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { anvil } from "viem/chains";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const argv = process.argv.slice(2).filter((a) => a !== "--");
const REDEPLOY = argv.includes("--redeploy");
const WITH_API = argv.includes("--with-api");
const WITH_INSTANT = argv.includes("--with-instant");
const SKIP_COMPOSED = argv.includes("--skip-composed");
const HELP = argv.includes("-h") || argv.includes("--help");

if (HELP) {
  console.log(`WP-100 Anvil protocol E2E

Flags:
  --redeploy       DeployLocal with SETTLEMENT_HUB_V3_AS_PRIMARY=1 + codegen
  --with-api       Also run e2e:arena-account (needs API + game server)
  --with-instant   Also run smoke:custody --run (Instant EOA path)
  --skip-composed  Skip spawning mock-vrf / proof-batch child scripts
`);
  process.exit(0);
}

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
const RPC = env.ANVIL_RPC_URL || "http://127.0.0.1:8545";
const API = (env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/$/, "");

/** Anvil defaults: #0 relayer/deployer/attestor, #1 attestor, #2 sessionSigner, #3/#4 owners */
const PK_RELAYER = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const PK_ATTESTOR2 = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const PK_SESSION = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";
const PK_ALICE = "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6";
const PK_BOB = "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a";

const TEMPLATE_V2 = keccak256(toBytes("NLHE_HU_STANDARD_V2"));
const BUY_IN = parseUnits("100", 6);
const RAKE = parseUnits("2", 6);
const RUN_ID = `wp100-${Date.now()}`;

const erc20Abi = parseAbi([
  "function faucet(uint256 amount)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);
const factoryAbi = parseAbi([
  "function createAccount(address owner) returns (address)",
  "function accountOf(address owner) view returns (address)",
  "function ownerOf(address account) view returns (address)",
]);
const accountAbi = parseAbi([
  "function setGamePermission(address sessionSigner,address usdc,address vault,bytes32 gameTemplateId,uint32 leagueMask,uint256 lifetimeCommittedCap,uint256 maxTotalAtRisk,uint256 maxSingleBuyIn,uint64 validUntil,uint16 maxConcurrentGames,bool ratedOnly,uint256 nonce,bool enabled,bytes signature)",
  "function gameAuthNonce() view returns (uint256)",
  "function gameAuth() view returns (address,address,address,bytes32,uint32,uint256,uint256,uint256,uint256,uint256,uint64,uint16,uint16,bool,bool)",
  "function owner() view returns (address)",
  "function withdraw(address token, uint256 amount, address to)",
]);
const vaultAbi = parseAbi([
  "function openSession((bytes32 sessionId,bytes32 gameTemplateId,bytes32 dealerRoot,bytes32 engineHash,bytes32 profileSetHash,uint64 emergencyExitDelay) config,(address player,bytes32 gameTemplateId,uint256 buyIn,bytes32 controllerHash,bytes32 agentProfileHash,uint64 expiresAt,uint256 nonce,bytes32 matchmakingPool,uint32 leagueBit,bool rated)[] tickets,bytes[] signatures)",
  "function settleSession(bytes32 sessionId,(address user,uint256 startLocked,uint256 endBalance)[] players,uint256 rake)",
  "function totalLocked(address user) view returns (uint256)",
  "function accruedProtocolFees() view returns (uint256)",
  "function withdrawProtocolFees(uint256 amount, bytes32 periodRoot, bytes32 sessionRange)",
  "function settlementHub() view returns (address)",
  "function sessions(bytes32) view returns (bytes32 sessionId,bytes32 templateId,bytes32 dealerRoot,bytes32 engineHash,bytes32 profileSetHash,uint64 openedAt,bool settled,uint64 lastSequence,bytes32 lastBalanceRoot,uint64 emergencyExitAfter)",
  "function usdcBalance() view returns (uint256)",
]);
const hubV3Abi = parseAbi([
  "function settle((bytes32 sessionId,uint64 finalSequence,bytes32 finalEventRoot,bytes32 handRoot,bytes32 balanceRoot,bytes32 randomnessEpochId,uint256 openingTotal,uint256 endingPlayerTotal,uint256 totalRake,uint64 proofBatchSequence,bytes32 modelPolicyHash,bytes32 profileSetHash,bytes32 gameTemplateId,bytes32 engineHash,uint256 deadline) settlement,(address user,uint256 startLocked,uint256 endBalance)[] players,bytes[] signatures,bytes32 verifierPolicyId)",
  "function settledSessions(bytes32) view returns (bool)",
  "function SEASON1_QUORUM_POLICY() view returns (bytes32)",
]);
const lifecycleAbi = parseAbi([
  "function createDraft(bytes32 sessionId, bytes32 gameTemplateId)",
  "function setDraftCommitments(bytes32 sessionId, bytes32 participantRoot, bytes32 openingBalanceRoot, bytes32 controllerRoot, bytes32 profileRoot)",
  "function seal(bytes32 sessionId, bytes32 sessionDescriptorHash, bytes32 dealerSecretRoot)",
  "function getSession(bytes32 sessionId) view returns ((uint8 state,bytes32 gameTemplateId,bytes32 participantRoot,bytes32 openingBalanceRoot,bytes32 controllerRoot,bytes32 profileRoot,bytes32 dealerSecretRoot,bytes32 sessionDescriptorHash,bytes32 vrfRequestId,bytes32 deckBatchRoot,uint64 createdAt,uint64 sealedAt,uint64 updatedAt))",
]);
const feeVaultAbi = parseAbi([
  "function accruedFees() view returns (uint256)",
  "function sweep(uint256 amount, bytes32 periodRoot, bytes32 sessionRange)",
  "function treasurySafe() view returns (address)",
]);
const registryAbi = parseAbi([
  "function nextSequence() view returns (uint64)",
  "function getBatch(uint64 sequence) view returns ((uint64 sequence,bytes32 previousBatchRoot,bytes32 globalRoot,bytes32 dataManifestHash,uint64 createdAt))",
]);

/** @typedef {'PASS'|'FAIL'|'GAP'|'SKIP'} StageStatus */

/** @type {{ id: string, title: string, status: StageStatus, detail: string }[]} */
const stages = [];

function record(id, title, status, detail = "") {
  stages.push({ id, title, status, detail });
  const icon = status === "PASS" ? "✓" : status === "FAIL" ? "✗" : status === "GAP" ? "○" : "–";
  console.log(`${icon} [${status}] ${title}${detail ? ` — ${detail}` : ""}`);
}

function failStage(id, title, err) {
  const msg = err instanceof Error ? err.message : String(err);
  record(id, title, "FAIL", msg);
  throw err instanceof Error ? err : new Error(msg);
}

async function runCmd(cmd, args, opts = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd || root,
      env: { ...process.env, ...opts.env },
      stdio: opts.silent ? "pipe" : "inherit",
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    if (opts.silent) {
      child.stdout?.on("data", (d) => {
        stdout += d;
      });
      child.stderr?.on("data", (d) => {
        stderr += d;
      });
    }
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolvePromise({ code, stdout, stderr });
      else reject(new Error(`${cmd} ${args.join(" ")} exited ${code}${stderr ? `\n${stderr}` : ""}`));
    });
  });
}

function loadManifest() {
  const path = resolve(root, "packages/chain-manifest/deployments/anvil.json");
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

async function checkRpc() {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
  });
  if (!res.ok) throw new Error(`RPC unreachable at ${RPC}`);
  const j = await res.json();
  if (j.result !== "0x7a69") throw new Error(`Unexpected chainId ${j.result} (want 31337)`);
}

async function apiHealthy() {
  try {
    const res = await fetch(`${API}/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

const SEAT_TICKET_TYPES = {
  SeatTicket: [
    { name: "player", type: "address" },
    { name: "gameTemplateId", type: "bytes32" },
    { name: "buyIn", type: "uint256" },
    { name: "controllerHash", type: "bytes32" },
    { name: "agentProfileHash", type: "bytes32" },
    { name: "expiresAt", type: "uint64" },
    { name: "nonce", type: "uint256" },
    { name: "matchmakingPool", type: "bytes32" },
    { name: "leagueBit", type: "uint32" },
    { name: "rated", type: "bool" },
  ],
};

const GAME_PERMISSION_TYPES = {
  GamePermission: [
    { name: "account", type: "address" },
    { name: "sessionSigner", type: "address" },
    { name: "usdc", type: "address" },
    { name: "vault", type: "address" },
    { name: "gameTemplateId", type: "bytes32" },
    { name: "leagueMask", type: "uint32" },
    { name: "lifetimeCommittedCap", type: "uint256" },
    { name: "maxTotalAtRisk", type: "uint256" },
    { name: "maxSingleBuyIn", type: "uint256" },
    { name: "validUntil", type: "uint64" },
    { name: "maxConcurrentGames", type: "uint16" },
    { name: "ratedOnly", type: "bool" },
    { name: "nonce", type: "uint256" },
    { name: "enabled", type: "bool" },
  ],
};

const FINAL_SETTLEMENT_V3_TYPES = {
  FinalSettlementV3: [
    { name: "sessionId", type: "bytes32" },
    { name: "finalSequence", type: "uint64" },
    { name: "finalEventRoot", type: "bytes32" },
    { name: "handRoot", type: "bytes32" },
    { name: "balanceRoot", type: "bytes32" },
    { name: "randomnessEpochId", type: "bytes32" },
    { name: "openingTotal", type: "uint256" },
    { name: "endingPlayerTotal", type: "uint256" },
    { name: "totalRake", type: "uint256" },
    { name: "proofBatchSequence", type: "uint64" },
    { name: "modelPolicyHash", type: "bytes32" },
    { name: "profileSetHash", type: "bytes32" },
    { name: "gameTemplateId", type: "bytes32" },
    { name: "engineHash", type: "bytes32" },
    { name: "deadline", type: "uint256" },
  ],
};

async function main() {
  console.log("\n=== WP-100 Full Anvil Protocol E2E ===\n");
  console.log("  runId:", RUN_ID);
  console.log("  RPC:  ", RPC);
  console.log("  flags:", {
    redeploy: REDEPLOY,
    withApi: WITH_API,
    withInstant: WITH_INSTANT,
    skipComposed: SKIP_COMPOSED,
  });
  console.log("");

  // ─── 0. Preflight ───────────────────────────────────────────────────────
  try {
    await checkRpc();
    record("preflight", "Anvil RPC chain 31337", "PASS", RPC);
  } catch (e) {
    failStage("preflight", "Anvil RPC chain 31337", e);
  }

  // ─── 1. Deploy (optional) ───────────────────────────────────────────────
  if (REDEPLOY) {
    try {
      console.log("\n--- DeployLocal (Hub V3 primary) ---\n");
      await runCmd(
        "forge",
        ["script", "script/DeployLocal.s.sol", "--rpc-url", RPC, "--broadcast", "-vv"],
        {
          cwd: resolve(root, "contracts"),
          env: {
            PATH: `${env.HOME || process.env.HOME}/.foundry/bin:${process.env.PATH}`,
            SETTLEMENT_HUB_V3_AS_PRIMARY: "1",
            // Force fresh MockUSDC
            USDC_ADDRESS: "",
          },
        },
      );
      await runCmd("pnpm", ["--filter", "@mozetto/chain-manifest", "codegen"]);
      record("deploy", "DeployLocal + codegen (Hub V3 primary)", "PASS");
    } catch (e) {
      failStage("deploy", "DeployLocal + codegen (Hub V3 primary)", e);
    }
  } else {
    record("deploy", "DeployLocal + codegen", "SKIP", "pass --redeploy for clean Hub V3 stack");
  }

  let manifest = loadManifest();
  if (!manifest?.usdc || !manifest?.arenaVault || !manifest?.arenaAccountFactory) {
    failStage(
      "manifest",
      "Load anvil.json custody addresses",
      new Error("Missing anvil.json — run with --redeploy or forge DeployLocal"),
    );
  }
  record(
    "manifest",
    "Load anvil.json",
    "PASS",
    `vault=${manifest.arenaVault.slice(0, 10)}… protocol=${manifest.protocolVersion}`,
  );

  const USDC = getAddress(manifest.usdc);
  const VAULT = getAddress(manifest.arenaVault);
  const FACTORY = getAddress(manifest.arenaAccountFactory);
  const HUB_V3 = manifest.settlementHubV3 && manifest.settlementHubV3 !== "null"
    ? getAddress(manifest.settlementHubV3)
    : null;
  const HUB = manifest.settlementHub ? getAddress(manifest.settlementHub) : null;
  const LIFECYCLE = manifest.sessionLifecycle && manifest.sessionLifecycle !== "null"
    ? getAddress(manifest.sessionLifecycle)
    : null;
  const FEE_VAULT = manifest.protocolFeeVault && manifest.protocolFeeVault !== "null"
    ? getAddress(manifest.protocolFeeVault)
    : null;
  const BEACON = manifest.randomnessBeacon && manifest.randomnessBeacon !== "null"
    ? getAddress(manifest.randomnessBeacon)
    : null;
  const PROOF_REG = manifest.proofBatchRegistry && manifest.proofBatchRegistry !== "null"
    ? getAddress(manifest.proofBatchRegistry)
    : null;
  const TREASURY = manifest.feeTreasury ? getAddress(manifest.feeTreasury) : null;

  const relayer = privateKeyToAccount(PK_RELAYER);
  const attestor2 = privateKeyToAccount(PK_ATTESTOR2);
  const sessionSigner = privateKeyToAccount(PK_SESSION);
  const alice = privateKeyToAccount(PK_ALICE);
  const bob = privateKeyToAccount(PK_BOB);

  const publicClient = createPublicClient({ chain: anvil, transport: http(RPC) });
  const relayerWallet = createWalletClient({ account: relayer, chain: anvil, transport: http(RPC) });
  const attestor2Wallet = createWalletClient({
    account: attestor2,
    chain: anvil,
    transport: http(RPC),
  });
  const sessionWallet = createWalletClient({
    account: sessionSigner,
    chain: anvil,
    transport: http(RPC),
  });
  const aliceWallet = createWalletClient({ account: alice, chain: anvil, transport: http(RPC) });
  const bobWallet = createWalletClient({ account: bob, chain: anvil, transport: http(RPC) });

  const ctx = {
    USDC,
    VAULT,
    FACTORY,
    HUB_V3,
    HUB,
    LIFECYCLE,
    FEE_VAULT,
    BEACON,
    PROOF_REG,
    TREASURY,
    publicClient,
    relayerWallet,
    attestor2Wallet,
    sessionWallet,
    aliceWallet,
    bobWallet,
    alice,
    bob,
    sessionSigner,
    relayer,
  };

  // ─── 2–4. Mint / ArenaAccounts / fund ───────────────────────────────────
  let aliceAccount;
  let bobAccount;
  try {
    const symbol = await publicClient.readContract({
      address: USDC,
      abi: erc20Abi,
      functionName: "symbol",
    });
    const decimals = await publicClient.readContract({
      address: USDC,
      abi: erc20Abi,
      functionName: "decimals",
    });
    if (symbol !== "mUSDC" || decimals !== 6) {
      throw new Error(`Expected mUSDC/6, got ${symbol}/${decimals}`);
    }

    const mintAmt = parseUnits("5000", 6);
    for (const [label, wallet, account] of [
      ["alice", aliceWallet, alice],
      ["bob", bobWallet, bob],
    ]) {
      const hash = await wallet.writeContract({
        address: USDC,
        abi: erc20Abi,
        functionName: "faucet",
        args: [mintAmt],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      const bal = await publicClient.readContract({
        address: USDC,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [account.address],
      });
      if (bal < mintAmt) throw new Error(`faucet under-minted for ${label}`);
    }
    record("mint", "Mint mUSDC via faucet (owners)", "PASS", `5000 each`);
  } catch (e) {
    failStage("mint", "Mint mUSDC via faucet (owners)", e);
  }

  try {
    const ensureAccount = async (owner) => {
      let addr = await publicClient.readContract({
        address: FACTORY,
        abi: factoryAbi,
        functionName: "accountOf",
        args: [owner.address],
      });
      if (addr === "0x0000000000000000000000000000000000000000") {
        const hash = await relayerWallet.writeContract({
          address: FACTORY,
          abi: factoryAbi,
          functionName: "createAccount",
          args: [owner.address],
        });
        await publicClient.waitForTransactionReceipt({ hash });
        addr = await publicClient.readContract({
          address: FACTORY,
          abi: factoryAbi,
          functionName: "accountOf",
          args: [owner.address],
        });
      }
      return getAddress(addr);
    };
    aliceAccount = await ensureAccount(alice);
    bobAccount = await ensureAccount(bob);
    record(
      "arena_accounts",
      "Create/resolve ArenaAccounts",
      "PASS",
      `A=${aliceAccount.slice(0, 10)}… B=${bobAccount.slice(0, 10)}…`,
    );
  } catch (e) {
    failStage("arena_accounts", "Create/resolve ArenaAccounts", e);
  }

  try {
    const fundAmt = parseUnits("1000", 6);
    for (const [wallet, accountAddr] of [
      [aliceWallet, aliceAccount],
      [bobWallet, bobAccount],
    ]) {
      const hash = await wallet.writeContract({
        address: USDC,
        abi: erc20Abi,
        functionName: "transfer",
        args: [accountAddr, fundAmt],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      const bal = await publicClient.readContract({
        address: USDC,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [accountAddr],
      });
      if (bal < fundAmt) throw new Error(`fund failed ${accountAddr}`);
    }
    record("fund", "Fund ArenaAccounts (owner → account transfer)", "PASS", "1000 mUSDC each");
  } catch (e) {
    failStage("fund", "Fund ArenaAccounts", e);
  }

  // ─── 5. GamePermission ──────────────────────────────────────────────────
  try {
    const enablePerm = async (ownerWallet, accountAddr) => {
      const nonce = await publicClient.readContract({
        address: accountAddr,
        abi: accountAbi,
        functionName: "gameAuthNonce",
      });
      const validUntil = BigInt(Math.floor(Date.now() / 1000) + 30 * 24 * 3600);
      const message = {
        account: accountAddr,
        sessionSigner: sessionSigner.address,
        usdc: USDC,
        vault: VAULT,
        gameTemplateId: TEMPLATE_V2,
        leagueMask: 0xffffffff,
        lifetimeCommittedCap: parseUnits("50000", 6),
        maxTotalAtRisk: parseUnits("5000", 6),
        maxSingleBuyIn: parseUnits("200", 6),
        validUntil,
        maxConcurrentGames: 4,
        ratedOnly: true,
        nonce,
        enabled: true,
      };
      const signature = await ownerWallet.signTypedData({
        domain: {
          name: "MozettoArenaAccount",
          version: "1",
          chainId: 31337,
          verifyingContract: accountAddr,
        },
        types: GAME_PERMISSION_TYPES,
        primaryType: "GamePermission",
        message,
      });
      const hash = await relayerWallet.writeContract({
        address: accountAddr,
        abi: accountAbi,
        functionName: "setGamePermission",
        args: [
          message.sessionSigner,
          message.usdc,
          message.vault,
          message.gameTemplateId,
          message.leagueMask,
          message.lifetimeCommittedCap,
          message.maxTotalAtRisk,
          message.maxSingleBuyIn,
          message.validUntil,
          message.maxConcurrentGames,
          message.ratedOnly,
          message.nonce,
          message.enabled,
          signature,
        ],
      });
      await publicClient.waitForTransactionReceipt({ hash });
    };
    await enablePerm(aliceWallet, aliceAccount);
    await enablePerm(bobWallet, bobAccount);
    record("permission", "Grant GamePermission (sessionSigner)", "PASS", sessionSigner.address.slice(0, 10) + "…");
  } catch (e) {
    failStage("permission", "Grant GamePermission", e);
  }

  // ─── 6. Match (API optional) ────────────────────────────────────────────
  if (WITH_API) {
    if (await apiHealthy()) {
      try {
        await runCmd("node", [resolve(root, "scripts/anvil-e2e-arena-account.mjs")]);
        record("match_api", "Ranked match via e2e:arena-account", "PASS");
      } catch (e) {
        failStage("match_api", "Ranked match via e2e:arena-account", e);
      }
    } else {
      record("match_api", "Ranked match via e2e:arena-account", "FAIL", `API not healthy at ${API}`);
      throw new Error("--with-api requested but API unhealthy");
    }
  } else {
    const healthy = await apiHealthy();
    record(
      "match_api",
      "Ranked match / find-match (API)",
      "GAP",
      healthy
        ? "API up — pass --with-api to compose e2e:arena-account"
        : "API down; on-chain lock uses openSession instead of matchmaker",
    );
  }

  // ─── 7. Lock buy-ins (openSession) ──────────────────────────────────────
  const sessionId = keccak256(toBytes(`${RUN_ID}-session`));
  const dealerRoot = keccak256(toBytes(`${RUN_ID}-dealer`));
  const engineHash = keccak256(toBytes("mozetto-nlhe-engine-v3-draft"));
  const profileSetHash = keccak256(toBytes("profile-set-v1"));
  const pool = keccak256(toBytes("mozetto:pool:wp100"));
  const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 3600);

  try {
    const mkTicket = (player, salt) => ({
      player,
      gameTemplateId: TEMPLATE_V2,
      buyIn: BUY_IN,
      controllerHash: keccak256(toBytes("ctrl")),
      agentProfileHash: keccak256(toBytes("profile")),
      expiresAt,
      nonce: BigInt(keccak256(toBytes(salt))),
      matchmakingPool: pool,
      leagueBit: 1,
      rated: true,
    });
    const tAlice = mkTicket(aliceAccount, `${RUN_ID}-alice`);
    const tBob = mkTicket(bobAccount, `${RUN_ID}-bob`);

    const vaultDomain = {
      name: "MozettoArenaVault",
      version: "2",
      chainId: 31337,
      verifyingContract: VAULT,
    };
    const sigAlice = await sessionWallet.signTypedData({
      domain: vaultDomain,
      types: SEAT_TICKET_TYPES,
      primaryType: "SeatTicket",
      message: tAlice,
    });
    const sigBob = await sessionWallet.signTypedData({
      domain: vaultDomain,
      types: SEAT_TICKET_TYPES,
      primaryType: "SeatTicket",
      message: tBob,
    });

    const openHash = await relayerWallet.writeContract({
      address: VAULT,
      abi: vaultAbi,
      functionName: "openSession",
      args: [
        {
          sessionId,
          gameTemplateId: TEMPLATE_V2,
          dealerRoot,
          engineHash,
          profileSetHash,
          emergencyExitDelay: 7n * 24n * 3600n,
        },
        [tAlice, tBob],
        [sigAlice, sigBob],
      ],
    });
    await publicClient.waitForTransactionReceipt({ hash: openHash });

    const lockedA = await publicClient.readContract({
      address: VAULT,
      abi: vaultAbi,
      functionName: "totalLocked",
      args: [aliceAccount],
    });
    const lockedB = await publicClient.readContract({
      address: VAULT,
      abi: vaultAbi,
      functionName: "totalLocked",
      args: [bobAccount],
    });
    if (lockedA < BUY_IN || lockedB < BUY_IN) {
      throw new Error(`locks too low: ${lockedA} / ${lockedB}`);
    }
    record(
      "lock",
      "Atomically lock buy-ins (openSession)",
      "PASS",
      `session=${sessionId.slice(0, 12)}… locked=${formatUnits(BUY_IN, 6)} each`,
    );
  } catch (e) {
    failStage("lock", "Atomically lock buy-ins (openSession)", e);
  }

  // ─── 8. Seal (SessionLifecycle draft→seal; sealAndFundSession GAP) ──────
  if (LIFECYCLE) {
    try {
      const participantRoot = keccak256(toBytes(`${RUN_ID}-participant`));
      const openingRoot = keccak256(toBytes(`${RUN_ID}-opening`));
      const controllerRoot = keccak256(toBytes(`${RUN_ID}-controller`));
      const profileRoot = profileSetHash;
      const descriptorHash = keccak256(toBytes(`${RUN_ID}-descriptor`));

      let hash = await relayerWallet.writeContract({
        address: LIFECYCLE,
        abi: lifecycleAbi,
        functionName: "createDraft",
        args: [sessionId, TEMPLATE_V2],
      });
      await publicClient.waitForTransactionReceipt({ hash });

      hash = await relayerWallet.writeContract({
        address: LIFECYCLE,
        abi: lifecycleAbi,
        functionName: "setDraftCommitments",
        args: [sessionId, participantRoot, openingRoot, controllerRoot, profileRoot],
      });
      await publicClient.waitForTransactionReceipt({ hash });

      hash = await relayerWallet.writeContract({
        address: LIFECYCLE,
        abi: lifecycleAbi,
        functionName: "seal",
        args: [sessionId, descriptorHash, dealerRoot],
      });
      await publicClient.waitForTransactionReceipt({ hash });

      const rec = await publicClient.readContract({
        address: LIFECYCLE,
        abi: lifecycleAbi,
        functionName: "getSession",
        args: [sessionId],
      });
      // State.Sealed = 2
      if (Number(rec.state) !== 2) {
        throw new Error(`expected lifecycle Sealed(2), got ${rec.state}`);
      }
      record(
        "seal_lifecycle",
        "SessionLifecycleV2 draft → seal",
        "PASS",
        "state=Sealed",
      );
    } catch (e) {
      failStage("seal_lifecycle", "SessionLifecycleV2 draft → seal", e);
    }
  } else {
    record(
      "seal_lifecycle",
      "SessionLifecycleV2 draft → seal",
      "GAP",
      "sessionLifecycle null in manifest — redeploy V3 stack",
    );
  }
  record(
    "seal_v3_atomic",
    "sealAndFundSession (WP-041 coordinator submit)",
    "GAP",
    "Coordinator package exists; this E2E uses openSession + lifecycle seal stubs (not atomic V3 sealAndFund)",
  );

  // ─── 9. Mock VRF + decks (compose WP-052) ───────────────────────────────
  if (SKIP_COMPOSED) {
    record("vrf_deck", "Mock VRF + deck batch (e2e:mock-vrf)", "SKIP", "--skip-composed");
  } else {
    try {
      const salt = `${RUN_ID}-vrf`;
      const extra = BEACON ? [] : ["--deploy-beacon"];
      await runCmd(
        "pnpm",
        ["--filter", "@mozetto/dealer-deck", "exec", "--", "node", "--import", "tsx", "../../scripts/anvil-mock-vrf-beacon.mjs", "--with-deck", ...extra],
        { env: { MOCK_VRF_SESSION_SALT: salt, ...(BEACON ? { RANDOMNESS_BEACON_ADDRESS: BEACON } : {}) } },
      );
      record("vrf_deck", "Mock VRF + dealer-deck batch", "PASS", `salt=${salt}`);
    } catch (e) {
      failStage("vrf_deck", "Mock VRF + dealer-deck batch", e);
    }
  }

  // ─── 10. Hands ──────────────────────────────────────────────────────────
  record(
    "hands",
    "AI-only hands / continuous cognition",
    "GAP",
    "Not wired end-to-end: needs live game-server + agent-runtime + dealer deal path (WP-083/084). Settlement uses stub roots.",
  );

  // ─── 11. Proof batch (compose WP-062) ───────────────────────────────────
  let proofBatchSequence = 0n;
  if (SKIP_COMPOSED) {
    record("proof_batch", "ProofBatchRegistry registerBatch", "SKIP", "--skip-composed");
  } else if (!PROOF_REG) {
    record(
      "proof_batch",
      "ProofBatchRegistry registerBatch",
      "GAP",
      "proofBatchRegistry null — redeploy; forge stub would deploy a disconnected registry",
    );
  } else {
    try {
      const before = await publicClient.readContract({
        address: PROOF_REG,
        abi: registryAbi,
        functionName: "nextSequence",
      });
      await runCmd("bash", [resolve(root, "scripts/anvil-proof-batch.sh")], {
        env: { PROOF_BATCH_REGISTRY_ADDRESS: PROOF_REG, ANVIL_RPC_URL: RPC },
      });
      const after = await publicClient.readContract({
        address: PROOF_REG,
        abi: registryAbi,
        functionName: "nextSequence",
      });
      if (after <= before) throw new Error(`nextSequence did not advance (${before} → ${after})`);
      proofBatchSequence = before; // registered sequence
      record(
        "proof_batch",
        "ProofBatchRegistry registerBatch",
        "PASS",
        `sequence=${proofBatchSequence} next=${after}`,
      );
    } catch (e) {
      failStage("proof_batch", "ProofBatchRegistry registerBatch", e);
    }
  }

  // ─── 12. Settlement ─────────────────────────────────────────────────────
  const aliceEnd = parseUnits("120", 6);
  const bobEnd = parseUnits("78", 6); // 120+78+2 = 200
  const openingTotal = BUY_IN * 2n;
  const endingPlayerTotal = aliceEnd + bobEnd;

  const settlementHubAddr = await publicClient.readContract({
    address: VAULT,
    abi: vaultAbi,
    functionName: "settlementHub",
  });
  const hubIsV3 =
    HUB_V3 && getAddress(settlementHubAddr) === HUB_V3;

  if (hubIsV3) {
    try {
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
      const settlement = {
        sessionId,
        finalSequence: 1n,
        finalEventRoot: keccak256(toBytes(`${RUN_ID}-evt`)),
        handRoot: keccak256(toBytes(`${RUN_ID}-hand`)),
        balanceRoot: keccak256(toBytes(`${RUN_ID}-bal`)),
        randomnessEpochId: keccak256(toBytes(`${RUN_ID}-rand-epoch`)),
        openingTotal,
        endingPlayerTotal,
        totalRake: RAKE,
        proofBatchSequence,
        modelPolicyHash: keccak256(toBytes("model-policy-groq")),
        profileSetHash,
        gameTemplateId: TEMPLATE_V2,
        engineHash,
        deadline,
      };
      const domain = {
        name: "MozettoPokerSettlement",
        version: "3",
        chainId: 31337,
        verifyingContract: HUB_V3,
      };
      const sig1 = await relayerWallet.signTypedData({
        domain,
        types: FINAL_SETTLEMENT_V3_TYPES,
        primaryType: "FinalSettlementV3",
        message: settlement,
      });
      const sig2 = await attestor2Wallet.signTypedData({
        domain,
        types: FINAL_SETTLEMENT_V3_TYPES,
        primaryType: "FinalSettlementV3",
        message: settlement,
      });
      const players = [
        { user: aliceAccount, startLocked: BUY_IN, endBalance: aliceEnd },
        { user: bobAccount, startLocked: BUY_IN, endBalance: bobEnd },
      ];
      const hash = await relayerWallet.writeContract({
        address: HUB_V3,
        abi: hubV3Abi,
        functionName: "settle",
        args: [settlement, players, [sig1, sig2], "0x" + "00".repeat(32)],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      const settled = await publicClient.readContract({
        address: HUB_V3,
        abi: hubV3Abi,
        functionName: "settledSessions",
        args: [sessionId],
      });
      if (!settled) throw new Error("hub.settledSessions=false after settle");
      record(
        "settlement",
        "Hub V3 quorum settle → ArenaAccounts",
        "PASS",
        `rake=${formatUnits(RAKE, 6)} ends=${formatUnits(aliceEnd, 6)}/${formatUnits(bobEnd, 6)}`,
      );
    } catch (e) {
      failStage("settlement", "Hub V3 quorum settle → ArenaAccounts", e);
    }
  } else if (HUB || settlementHubAddr) {
    try {
      const hubAddr = getAddress(settlementHubAddr || HUB);
      await fetch(RPC, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "anvil_impersonateAccount",
          params: [hubAddr],
        }),
      });
      await fetch(RPC, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "anvil_setBalance",
          params: [hubAddr, "0x56BC75E2D63100000"],
        }),
      });
      const hubClient = createWalletClient({
        account: hubAddr,
        chain: anvil,
        transport: http(RPC),
      });
      const hash = await hubClient.writeContract({
        address: VAULT,
        abi: vaultAbi,
        functionName: "settleSession",
        args: [
          sessionId,
          [
            { user: aliceAccount, startLocked: BUY_IN, endBalance: aliceEnd },
            { user: bobAccount, startLocked: BUY_IN, endBalance: bobEnd },
          ],
          RAKE,
        ],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      const sess = await publicClient.readContract({
        address: VAULT,
        abi: vaultAbi,
        functionName: "sessions",
        args: [sessionId],
      });
      if (!sess.settled) throw new Error("vault session not settled");
      record(
        "settlement",
        "Vault settleSession via hub impersonation (V2 path)",
        "PASS",
        `hub=${hubAddr.slice(0, 10)}…`,
      );
      record(
        "settlement_hub_v3",
        "Hub V3 quorum settle",
        "GAP",
        HUB_V3
          ? `vault.settlementHub=${settlementHubAddr} ≠ hubV3 — redeploy with SETTLEMENT_HUB_V3_AS_PRIMARY=1`
          : "settlementHubV3 missing from manifest — redeploy V3 stack",
      );
    } catch (e) {
      failStage("settlement", "Vault settleSession via hub impersonation", e);
    }
  } else {
    failStage(
      "settlement",
      "Settlement",
      new Error("No settlementHub in manifest and vault hub unset"),
    );
  }

  // ─── 13. Rake → ProtocolFeeVault → treasury sweep ───────────────────────
  if (FEE_VAULT) {
    try {
      const accrued = await publicClient.readContract({
        address: VAULT,
        abi: vaultAbi,
        functionName: "accruedProtocolFees",
      });
      if (accrued < RAKE) throw new Error(`accruedProtocolFees ${accrued} < rake ${RAKE}`);
      const periodRoot = keccak256(toBytes(`${RUN_ID}-period`));
      const sessionRange = keccak256(toBytes(`${RUN_ID}-range`));
      let hash = await relayerWallet.writeContract({
        address: VAULT,
        abi: vaultAbi,
        functionName: "withdrawProtocolFees",
        args: [accrued, periodRoot, sessionRange],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      const feeAccrued = await publicClient.readContract({
        address: FEE_VAULT,
        abi: feeVaultAbi,
        functionName: "accruedFees",
      });
      if (feeAccrued < RAKE) throw new Error(`fee vault accrued ${feeAccrued} < rake`);

      const treasuryBefore = TREASURY
        ? await publicClient.readContract({
            address: USDC,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [TREASURY],
          })
        : 0n;
      hash = await relayerWallet.writeContract({
        address: FEE_VAULT,
        abi: feeVaultAbi,
        functionName: "sweep",
        args: [feeAccrued, periodRoot, sessionRange],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      if (TREASURY) {
        const treasuryAfter = await publicClient.readContract({
          address: USDC,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [TREASURY],
        });
        if (treasuryAfter < treasuryBefore + feeAccrued) {
          throw new Error("treasury did not receive sweep");
        }
      }
      record(
        "rake",
        "Rake → ProtocolFeeVault → treasury sweep",
        "PASS",
        `swept ${formatUnits(feeAccrued, 6)} mUSDC`,
      );
    } catch (e) {
      failStage("rake", "Rake → ProtocolFeeVault → treasury sweep", e);
    }
  } else {
    record(
      "rake",
      "Rake → ProtocolFeeVault → treasury sweep",
      "GAP",
      "protocolFeeVault null in manifest — redeploy",
    );
  }

  // ─── 14. Owner withdraw ─────────────────────────────────────────────────
  try {
    const withdrawFrom = async (ownerWallet, accountAddr, label) => {
      const bal = await publicClient.readContract({
        address: USDC,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [accountAddr],
      });
      if (bal === 0n) throw new Error(`${label} ArenaAccount balance 0 after settle`);
      const ownerBefore = await publicClient.readContract({
        address: USDC,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [ownerWallet.account.address],
      });
      const hash = await ownerWallet.writeContract({
        address: accountAddr,
        abi: accountAbi,
        functionName: "withdraw",
        args: [USDC, bal, ownerWallet.account.address],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      const ownerAfter = await publicClient.readContract({
        address: USDC,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [ownerWallet.account.address],
      });
      if (ownerAfter !== ownerBefore + bal) {
        throw new Error(`${label} withdraw conservation failed`);
      }
      return bal;
    };
    const aOut = await withdrawFrom(aliceWallet, aliceAccount, "alice");
    const bOut = await withdrawFrom(bobWallet, bobAccount, "bob");
    record(
      "withdraw",
      "Owner withdraw from ArenaAccounts",
      "PASS",
      `alice=${formatUnits(aOut, 6)} bob=${formatUnits(bOut, 6)}`,
    );
  } catch (e) {
    failStage("withdraw", "Owner withdraw from ArenaAccounts", e);
  }

  // ─── 15. Reconcile ──────────────────────────────────────────────────────
  try {
    const lockedA = await publicClient.readContract({
      address: VAULT,
      abi: vaultAbi,
      functionName: "totalLocked",
      args: [aliceAccount],
    });
    const lockedB = await publicClient.readContract({
      address: VAULT,
      abi: vaultAbi,
      functionName: "totalLocked",
      args: [bobAccount],
    });
    if (lockedA !== 0n || lockedB !== 0n) {
      throw new Error(`residual locks ${lockedA}/${lockedB}`);
    }
    const accruedLeft = await publicClient.readContract({
      address: VAULT,
      abi: vaultAbi,
      functionName: "accruedProtocolFees",
    });
    if (FEE_VAULT && accruedLeft !== 0n) {
      throw new Error(`residual accruedProtocolFees ${accruedLeft}`);
    }
    record("reconcile", "Reconcile locks + accrued fees = 0", "PASS");
  } catch (e) {
    failStage("reconcile", "Reconcile locks + accrued fees = 0", e);
  }

  // ─── Optional Instant smoke ─────────────────────────────────────────────
  if (WITH_INSTANT) {
    try {
      await runCmd("node", [resolve(root, "scripts/anvil-custody-smoke.mjs"), "--run"]);
      record("instant_smoke", "Compose smoke:custody --run", "PASS");
    } catch (e) {
      failStage("instant_smoke", "Compose smoke:custody --run", e);
    }
  } else {
    record("instant_smoke", "Compose smoke:custody --run", "SKIP", "pass --with-instant");
  }

  // ─── Report ─────────────────────────────────────────────────────────────
  const counts = { PASS: 0, FAIL: 0, GAP: 0, SKIP: 0 };
  for (const s of stages) counts[s.status]++;

  const report = {
    workPacket: "WP-100",
    runId: RUN_ID,
    timestamp: new Date().toISOString(),
    rpc: RPC,
    flags: { redeploy: REDEPLOY, withApi: WITH_API, withInstant: WITH_INSTANT, skipComposed: SKIP_COMPOSED },
    addresses: {
      usdc: USDC,
      vault: VAULT,
      factory: FACTORY,
      settlementHub: settlementHubAddr,
      settlementHubV3: HUB_V3,
      sessionLifecycle: LIFECYCLE,
      protocolFeeVault: FEE_VAULT,
      randomnessBeacon: BEACON,
      proofBatchRegistry: PROOF_REG,
      aliceAccount,
      bobAccount,
      sessionId,
    },
    stages,
    counts,
    overall: counts.FAIL === 0 ? (counts.GAP > 0 ? "PASS_WITH_GAPS" : "PASS") : "FAIL",
    gapsDocumented: stages.filter((s) => s.status === "GAP").map((s) => ({ id: s.id, title: s.title, detail: s.detail })),
  };

  const outPath = resolve(root, "scripts/.anvil-e2e-protocol-v3-last.json");
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);

  console.log("\n=== WP-100 REPORT ===\n");
  console.log(`  overall: ${report.overall}`);
  console.log(`  PASS=${counts.PASS} FAIL=${counts.FAIL} GAP=${counts.GAP} SKIP=${counts.SKIP}`);
  if (report.gapsDocumented.length) {
    console.log("\n  Documented gaps:");
    for (const g of report.gapsDocumented) {
      console.log(`    • ${g.title}: ${g.detail}`);
    }
  }
  console.log(`\n  Wrote ${outPath}`);
  console.log("  See docs/WP-100_ANVIL_E2E.md\n");

  if (counts.FAIL > 0) process.exit(1);
}

main().catch((e) => {
  console.error("\nWP-100 FATAL:", e instanceof Error ? e.message : e);
  const counts = { PASS: 0, FAIL: 0, GAP: 0, SKIP: 0 };
  for (const s of stages) counts[s.status]++;
  console.log(`\nPartial: PASS=${counts.PASS} FAIL=${counts.FAIL} GAP=${counts.GAP} SKIP=${counts.SKIP}`);
  process.exit(1);
});
