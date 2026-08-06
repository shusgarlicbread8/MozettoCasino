#!/usr/bin/env node
/**
 * Anvil Instant Mode smoke — faucet → max approve → lock-from-wallet openSession → settle-to-wallet.
 *
 * Usage:
 *   node scripts/anvil-custody-smoke.mjs           # checklist + health
 *   node scripts/anvil-custody-smoke.mjs --run     # execute Instant path
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
  keccak256,
  toBytes,
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

const fileEnv = { ...loadEnvFile(".env.example"), ...loadEnvFile(".env.local") };
const env = { ...fileEnv, ...process.env };
const run = process.argv.includes("--run");

const RPC = env.ANVIL_RPC_URL || "http://127.0.0.1:8545";
const API = (env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/$/, "");
const PK_A =
  env.SESSION_RELAYER_PRIVATE_KEY ||
  env.PRIVATE_KEY ||
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const PK_B = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

const manifestPath = resolve(root, "packages/chain-manifest/deployments/anvil.json");
const manifest = existsSync(manifestPath)
  ? JSON.parse(readFileSync(manifestPath, "utf8"))
  : {};
const USDC = manifest.usdc || fileEnv.USDC_ADDRESS || fileEnv.NEXT_PUBLIC_USDC_ADDRESS;
const VAULT =
  manifest.arenaVault || fileEnv.ARENA_VAULT_ADDRESS || fileEnv.NEXT_PUBLIC_ARENA_VAULT_ADDRESS;
const HUB = manifest.settlementHub || fileEnv.SETTLEMENT_HUB_ADDRESS;

console.log("\n=== Anvil Instant Mode smoke ===\n");
console.log("  RPC:", RPC);
console.log("  USDC:", USDC || "(missing)");
console.log("  VAULT:", VAULT || "(missing)");
console.log("  HUB:", HUB || "(missing)");
console.log("  API:", API);

const erc20 = parseAbi([
  "function faucet(uint256 amount)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function nonces(address owner) view returns (uint256)",
  "function name() view returns (string)",
]);
const vaultAbi = parseAbi([
  "function deposit(uint256 amount)",
  "function withdraw(uint256 amount, address to)",
  "function available(address user) view returns (uint256)",
  "function totalLocked(address user) view returns (uint256)",
  "function usdcBalance() view returns (uint256)",
  "function openSession((bytes32 sessionId,bytes32 gameTemplateId,bytes32 dealerRoot,bytes32 engineHash,bytes32 profileSetHash,uint64 emergencyExitDelay) config,(address player,bytes32 gameTemplateId,uint256 buyIn,bytes32 controllerHash,bytes32 agentProfileHash,uint64 expiresAt,uint256 nonce,bytes32 matchmakingPool)[] tickets,bytes[] signatures)",
  "function settleSession(bytes32 sessionId,(address user,uint256 startLocked,uint256 endBalance)[] players,uint256 rake)",
  "function setSettlementHub(address hub)",
  "function setInstantPermission(address player,address sessionSigner,uint256 spendCap,uint256 maxSingleBuyIn,uint64 expiresAt,uint256 nonce,bool enabled,bytes signature)",
  "function instantAuthNonce(address player) view returns (uint256)",
  "function remainingInstantSpend(address player) view returns (uint256)",
  "function instantAuth(address player) view returns (address sessionSigner,uint256 spendCap,uint256 spent,uint256 maxSingleBuyIn,uint64 expiresAt,bool enabled)",
]);

/** Anvil account #2 — dedicated Instant session signer (not relayer). */
const PK_SESSION =
  env.INSTANT_SESSION_SIGNER_PRIVATE_KEY ||
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";

async function checkRpc() {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
  });
  const j = await res.json();
  if (j.result !== "0x7a69") throw new Error(`Unexpected chainId ${j.result}`);
  console.log("✓ Anvil chain 31337");
}

async function checkApi() {
  const res = await fetch(`${API}/health`);
  if (!res.ok) throw new Error(`API health ${res.status}`);
  console.log("✓ API healthy");
}

function seatTicketTypes() {
  return {
    SeatTicket: [
      { name: "player", type: "address" },
      { name: "gameTemplateId", type: "bytes32" },
      { name: "buyIn", type: "uint256" },
      { name: "controllerHash", type: "bytes32" },
      { name: "agentProfileHash", type: "bytes32" },
      { name: "expiresAt", type: "uint64" },
      { name: "nonce", type: "uint256" },
      { name: "matchmakingPool", type: "bytes32" },
    ],
  };
}

async function runInstant() {
  if (!USDC || !VAULT) throw new Error("Missing USDC/VAULT addresses — deploy first");

  const alice = privateKeyToAccount(PK_A);
  const bob = privateKeyToAccount(PK_B);
  const publicClient = createPublicClient({ chain: anvil, transport: http(RPC) });
  const aliceWallet = createWalletClient({ account: alice, chain: anvil, transport: http(RPC) });
  const bobWallet = createWalletClient({ account: bob, chain: anvil, transport: http(RPC) });
  const relayer = aliceWallet; // DeployLocal sets sessionRelayer = deployer (account0)

  const symbol = await publicClient.readContract({
    address: USDC,
    abi: erc20,
    functionName: "symbol",
  });
  const decimals = await publicClient.readContract({
    address: USDC,
    abi: erc20,
    functionName: "decimals",
  });
  if (symbol !== "mUSDC" || decimals !== 6) {
    throw new Error(`Expected mUSDC/6, got ${symbol}/${decimals}`);
  }
  console.log("✓ Token metadata mUSDC / 6 decimals");

  // Permit support (ERC20Permit on MockUSDC)
  try {
    await publicClient.readContract({
      address: USDC,
      abi: erc20,
      functionName: "nonces",
      args: [alice.address],
    });
    console.log("✓ MockUSDC supports EIP-2612 permit (Instant enable path)");
  } catch {
    throw new Error("MockUSDC missing nonces() — redeploy with ERC20Permit");
  }

  const mintAmt = parseUnits("100000", 6);
  for (const [label, wallet, account] of [
    ["alice", aliceWallet, alice],
    ["bob", bobWallet, bob],
  ]) {
    const hash = await wallet.writeContract({
      address: USDC,
      abi: erc20,
      functionName: "faucet",
      args: [mintAmt],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    const bal = await publicClient.readContract({
      address: USDC,
      abi: erc20,
      functionName: "balanceOf",
      args: [account.address],
    });
    if (bal < mintAmt) throw new Error(`Faucet failed for ${label}`);
    console.log(`✓ Faucet ${label}`, formatUnits(mintAmt, 6), "mUSDC");

    const approveHash = await wallet.writeContract({
      address: USDC,
      abi: erc20,
      functionName: "approve",
      args: [VAULT, maxUint256],
    });
    await publicClient.waitForTransactionReceipt({ hash: approveHash });
    const allowance = await publicClient.readContract({
      address: USDC,
      abi: erc20,
      functionName: "allowance",
      args: [account.address, VAULT],
    });
    if (allowance < 1_000_000n * 10n ** 6n) throw new Error(`Instant approve failed for ${label}`);
    console.log(`✓ Instant enable (max approve) ${label}`);
  }

  const buyIn = parseUnits("5000", 6);
  const templateId = keccak256(toBytes("NLHE_HU_STANDARD_V1"));
  const sessionId = keccak256(toBytes(`instant-smoke-${Date.now()}`));
  const pool = keccak256(toBytes("mozetto:pool:smoke"));
  const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const domain = {
    name: "MozettoArenaVault",
    version: "1",
    chainId: 31337,
    verifyingContract: VAULT,
  };

  const mkTicket = (player, nonce) => ({
    player,
    gameTemplateId: templateId,
    buyIn,
    controllerHash: keccak256(toBytes("ctrl")),
    agentProfileHash: keccak256(toBytes("agent")),
    expiresAt,
    nonce: BigInt(nonce),
    matchmakingPool: pool,
  });

  const tAlice = mkTicket(alice.address, Date.now());
  const tBob = mkTicket(bob.address, Date.now() + 1);
  const sigAlice = await aliceWallet.signTypedData({
    account: alice,
    domain,
    types: seatTicketTypes(),
    primaryType: "SeatTicket",
    message: tAlice,
  });
  const sigBob = await bobWallet.signTypedData({
    account: bob,
    domain,
    types: seatTicketTypes(),
    primaryType: "SeatTicket",
    message: tBob,
  });

  const aliceBefore = await publicClient.readContract({
    address: USDC,
    abi: erc20,
    functionName: "balanceOf",
    args: [alice.address],
  });
  const bobBefore = await publicClient.readContract({
    address: USDC,
    abi: erc20,
    functionName: "balanceOf",
    args: [bob.address],
  });

  const openHash = await relayer.writeContract({
    address: VAULT,
    abi: vaultAbi,
    functionName: "openSession",
    args: [
      {
        sessionId,
        gameTemplateId: templateId,
        dealerRoot: keccak256(toBytes("dealer")),
        engineHash: keccak256(toBytes("engine")),
        profileSetHash: keccak256(toBytes("profiles")),
        emergencyExitDelay: 3600n,
      },
      [tAlice, tBob],
      [sigAlice, sigBob],
    ],
  });
  await publicClient.waitForTransactionReceipt({ hash: openHash });

  const aliceAfterLock = await publicClient.readContract({
    address: USDC,
    abi: erc20,
    functionName: "balanceOf",
    args: [alice.address],
  });
  const bobAfterLock = await publicClient.readContract({
    address: USDC,
    abi: erc20,
    functionName: "balanceOf",
    args: [bob.address],
  });
  if (aliceAfterLock !== aliceBefore - buyIn || bobAfterLock !== bobBefore - buyIn) {
    throw new Error("openSession did not pull buy-in from wallets");
  }
  console.log("✓ Instant lock-from-wallet openSession (−5000 each)");

  const aliceAvail = await publicClient.readContract({
    address: VAULT,
    abi: vaultAbi,
    functionName: "available",
    args: [alice.address],
  });
  if (aliceAvail !== 0n) throw new Error("Expected zero vault available after Instant lock");
  console.log("✓ No idle vault available required");

  // Settle as hub: deployer is also settlement hub owner; call vault.settleSession via hub address
  // DeployLocal sets hub as settlement — use impersonation via anvil_impersonate OR call as hub.
  // Simplest: vault.settleSession onlySettlement — use cast/anvil to set msg.sender = hub.
  // Instead call through a direct settle if we can prank — use eth_sendTransaction from hub via anvil unlocked.
  if (!HUB) {
    console.log("⚠ No settlementHub in manifest — skip settle-to-wallet check");
  } else {
    // Anvil default: use `impersonateAccount` JSON-RPC
    await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "anvil_impersonateAccount",
        params: [HUB],
      }),
    });
    await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "anvil_setBalance",
        params: [HUB, "0x56BC75E2D63100000"],
      }),
    });

    const hubClient = createWalletClient({
      account: HUB,
      chain: anvil,
      transport: http(RPC),
    });

    const rake = parseUnits("200", 6);
    const aliceEnd = parseUnits("5800", 6);
    const bobEnd = parseUnits("4000", 6);
    const settleHash = await hubClient.writeContract({
      address: VAULT,
      abi: vaultAbi,
      functionName: "settleSession",
      args: [
        sessionId,
        [
          { user: alice.address, startLocked: buyIn, endBalance: aliceEnd },
          { user: bob.address, startLocked: buyIn, endBalance: bobEnd },
        ],
        rake,
      ],
    });
    await publicClient.waitForTransactionReceipt({ hash: settleHash });

    const aliceFinal = await publicClient.readContract({
      address: USDC,
      abi: erc20,
      functionName: "balanceOf",
      args: [alice.address],
    });
    const bobFinal = await publicClient.readContract({
      address: USDC,
      abi: erc20,
      functionName: "balanceOf",
      args: [bob.address],
    });
    if (aliceFinal !== aliceAfterLock + aliceEnd || bobFinal !== bobAfterLock + bobEnd) {
      throw new Error("Settle did not return USDC to wallets");
    }
    console.log("✓ Settle-to-wallet (+endBalance to each wallet)");
    console.log("  settle tx:", settleHash);
  }

  // --- InstantPermission: session-signer tickets, cap reject, revoke ---
  const sessionSigner = privateKeyToAccount(PK_SESSION);
  const sessionWallet = createWalletClient({
    account: sessionSigner,
    chain: anvil,
    transport: http(RPC),
  });
  if (sessionSigner.address.toLowerCase() === alice.address.toLowerCase()) {
    throw new Error("INSTANT_SESSION_SIGNER_PRIVATE_KEY must differ from relayer key");
  }

  const authNonce = await publicClient.readContract({
    address: VAULT,
    abi: vaultAbi,
    functionName: "instantAuthNonce",
    args: [alice.address],
  });
  const spendCap = parseUnits("1200", 6);
  const maxSingle = parseUnits("1000", 6);
  const permExpires = BigInt(Math.floor(Date.now() / 1000) + 30 * 24 * 3600);
  const permMsg = {
    player: alice.address,
    sessionSigner: sessionSigner.address,
    spendCap,
    maxSingleBuyIn: maxSingle,
    expiresAt: permExpires,
    nonce: authNonce,
    enabled: true,
  };
  const permTypes = {
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
  const permSig = await aliceWallet.signTypedData({
    account: alice,
    domain,
    types: permTypes,
    primaryType: "InstantPermission",
    message: permMsg,
  });
  const permHash = await relayer.writeContract({
    address: VAULT,
    abi: vaultAbi,
    functionName: "setInstantPermission",
    args: [
      alice.address,
      sessionSigner.address,
      spendCap,
      maxSingle,
      permExpires,
      authNonce,
      true,
      permSig,
    ],
  });
  await publicClient.waitForTransactionReceipt({ hash: permHash });
  console.log("✓ InstantPermission authorized (session signer + spend cap)");

  const buyInSmall = parseUnits("500", 6);
  const openSessionSigned = async (sid, nonce, amount, signerWallet, signerAccount) => {
    const ticket = {
      player: alice.address,
      gameTemplateId: templateId,
      buyIn: amount,
      controllerHash: keccak256(toBytes("ctrl2")),
      agentProfileHash: keccak256(toBytes("agent2")),
      expiresAt: BigInt(Math.floor(Date.now() / 1000) + 3600),
      nonce: BigInt(nonce),
      matchmakingPool: keccak256(toBytes("mozetto:pool:instant-auth")),
    };
    const sig = await signerWallet.signTypedData({
      account: signerAccount,
      domain,
      types: seatTicketTypes(),
      primaryType: "SeatTicket",
      message: ticket,
    });
    // Pair with bob player-signed ticket for openSession length >= 1; use single-player by also
    // opening with only alice if vault allows — vault requires tickets.length > 0, 1 is ok.
    const hash = await relayer.writeContract({
      address: VAULT,
      abi: vaultAbi,
      functionName: "openSession",
      args: [
        {
          sessionId: sid,
          gameTemplateId: templateId,
          dealerRoot: keccak256(toBytes("dealer2")),
          engineHash: keccak256(toBytes("engine2")),
          profileSetHash: keccak256(toBytes("profiles2")),
          emergencyExitDelay: 3600n,
        },
        [ticket],
        [sig],
      ],
    });
    await publicClient.waitForTransactionReceipt({ hash });
  };

  const sid1 = keccak256(toBytes(`instant-auth-1-${Date.now()}`));
  await openSessionSigned(sid1, Date.now() + 10, buyInSmall, sessionWallet, sessionSigner);
  console.log("✓ Session-signer SeatTicket join #1 (no player wallet popup)");

  const sid2 = keccak256(toBytes(`instant-auth-2-${Date.now()}`));
  await openSessionSigned(sid2, Date.now() + 11, buyInSmall, sessionWallet, sessionSigner);
  console.log("✓ Session-signer SeatTicket join #2");

  const remaining = await publicClient.readContract({
    address: VAULT,
    abi: vaultAbi,
    functionName: "remainingInstantSpend",
    args: [alice.address],
  });
  if (remaining !== spendCap - buyInSmall * 2n) {
    throw new Error(`Expected remaining ${spendCap - buyInSmall * 2n}, got ${remaining}`);
  }
  console.log("✓ Spend budget decremented (settle does not refill)");

  let capRejected = false;
  try {
    await openSessionSigned(
      keccak256(toBytes(`instant-auth-cap-${Date.now()}`)),
      Date.now() + 12,
      parseUnits("300", 6),
      sessionWallet,
      sessionSigner,
    );
  } catch {
    capRejected = true;
  }
  if (!capRejected) throw new Error("Expected InstantSpendCapExceeded on third join");
  console.log("✓ Cap rejection after budget exhaustion");

  const revokeNonce = await publicClient.readContract({
    address: VAULT,
    abi: vaultAbi,
    functionName: "instantAuthNonce",
    args: [alice.address],
  });
  const revokeSig = await aliceWallet.signTypedData({
    account: alice,
    domain,
    types: permTypes,
    primaryType: "InstantPermission",
    message: {
      player: alice.address,
      sessionSigner: sessionSigner.address,
      spendCap: 0n,
      maxSingleBuyIn: 0n,
      expiresAt: 0n,
      nonce: revokeNonce,
      enabled: false,
    },
  });
  const revokeHash = await relayer.writeContract({
    address: VAULT,
    abi: vaultAbi,
    functionName: "setInstantPermission",
    args: [
      alice.address,
      sessionSigner.address,
      0n,
      0n,
      0n,
      revokeNonce,
      false,
      revokeSig,
    ],
  });
  await publicClient.waitForTransactionReceipt({ hash: revokeHash });
  console.log("✓ Gasless InstantPermission revoke (relayer-submitted)");

  let joinBlocked = false;
  try {
    await openSessionSigned(
      keccak256(toBytes(`instant-auth-revoked-${Date.now()}`)),
      Date.now() + 13,
      buyInSmall,
      sessionWallet,
      sessionSigner,
    );
  } catch {
    joinBlocked = true;
  }
  if (!joinBlocked) throw new Error("Expected join blocked after revoke");
  console.log("✓ Join blocked after revoke");

  console.log(
    "\nInstant Mode smoke passed (faucet → enable → lock → settle-to-wallet → InstantPermission auto-joins → cap → revoke).",
  );
}

await checkRpc();
await checkApi().catch((e) => console.log("⚠ API:", e.message));

if (!run) {
  console.log("\nPass --run to execute Instant Mode custody path.");
  process.exit(0);
}

try {
  await runInstant();
} catch (e) {
  console.error("\n✗ Smoke failed:", e.message);
  process.exit(1);
}
