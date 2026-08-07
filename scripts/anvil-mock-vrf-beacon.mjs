#!/usr/bin/env node
/**
 * WP-052 — Deterministic Anvil mock VRF path for RandomnessBeaconV2.
 *
 * Lifecycle: commitSecretRoot → requestVrf → fulfillMock → registerDeckBatch
 *
 * Usage:
 *   pnpm e2e:mock-vrf
 *   pnpm --filter @mozetto/dealer-deck exec -- node --import tsx ../../scripts/anvil-mock-vrf-beacon.mjs
 *   pnpm e2e:mock-vrf -- --with-deck
 *   pnpm e2e:mock-vrf -- --deploy-beacon
 *
 * Requires Anvil at ANVIL_RPC_URL (default http://127.0.0.1:8545).
 * Prefers packages/chain-manifest/deployments/anvil.json randomnessBeacon.
 */

import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  keccak256,
  toBytes,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { anvil } from "viem/chains";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

// pnpm may forward a bare "--" when using `pnpm e2e:mock-vrf -- --with-deck`
const argv = process.argv.slice(2).filter((a) => a !== "--");
const withDeck = argv.includes("--with-deck");
const deployBeacon = argv.includes("--deploy-beacon");

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
const PK =
  env.PRIVATE_KEY ||
  env.SESSION_RELAYER_PRIVATE_KEY ||
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

/** Keep in sync with contracts/script/MockVrfAnvil.s.sol */
const SESSION_SALT = env.MOCK_VRF_SESSION_SALT || "wp052-session";
const EPOCH = BigInt(env.MOCK_VRF_EPOCH || "1");
const SESSION_ID = keccak256(toBytes(SESSION_SALT));
const PARTICIPANT_ROOT = keccak256(toBytes("wp052-participant-root"));
const GAME_TEMPLATE = keccak256(toBytes("NLHE_HU_STANDARD_V2"));
const VRF_RESULT = keccak256(toBytes("wp052-mock-vrf-result"));
const FIXTURE_DECK_BATCH = keccak256(toBytes("wp052-deck-batch-root"));
const FIXTURE_ATTESTATION = keccak256(toBytes("wp052-dealer-attestation"));
const SECRET_ROOT = keccak256(toBytes(`wp052-dealer-secret-root:${SESSION_SALT}`));

const beaconAbi = parseAbi([
  "constructor(address owner_, bool mockVrfEnabled_)",
  "function mockVrfEnabled() view returns (bool)",
  "function operator() view returns (address)",
  "function setOperator(address operator_)",
  "function commitSecretRoot(bytes32 sessionId,uint64 randomnessEpoch,bytes32 dealerSecretRoot,bytes32 participantRoot,bytes32 gameTemplateId) returns (bytes32)",
  "function requestVrf(bytes32 sessionId,uint64 randomnessEpoch) returns (uint256)",
  "function fulfillMock(bytes32 sessionId,uint64 randomnessEpoch,bytes32 vrfResult)",
  "function registerDeckBatch(bytes32 sessionId,uint64 randomnessEpoch,bytes32 deckBatchRoot,bytes32 dealerAttestationHash)",
  "function getEpoch(bytes32 sessionId,uint64 randomnessEpoch) view returns ((bytes32 sessionId,uint64 randomnessEpoch,bytes32 dealerSecretRoot,bytes32 participantRoot,bytes32 gameTemplateId,bytes32 bindingHash,uint256 vrfRequestId,bytes32 vrfResult,bytes32 deckBatchRoot,bytes32 deckBatchBind,bytes32 dealerAttestationHash,uint8 phase,uint64 committedAt,uint64 requestedAt,uint64 fulfilledAt,uint64 deckBatchAt,bool usedMockVrf))",
  "function computeDeckBatchBind(bytes32 sessionId,uint64 randomnessEpoch,bytes32 deckBatchRoot) view returns (bytes32)",
  "function DOMAIN_DECK_BATCH_V1() view returns (bytes32)",
]);

const beaconBytecodeArtifact = resolve(
  root,
  "contracts/out/RandomnessBeaconV2.sol/RandomnessBeaconV2.json",
);

function ok(msg) {
  console.log(`✓ ${msg}`);
}
function fail(msg) {
  console.error(`✗ ${msg}`);
  throw new Error(msg);
}

async function checkRpc() {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
  });
  if (!res.ok) fail(`RPC unreachable at ${RPC}`);
  const j = await res.json();
  if (j.result !== "0x7a69") fail(`Unexpected chainId ${j.result} (want 31337)`);
  ok(`Anvil chain 31337 @ ${RPC}`);
}

function loadManifestBeacon() {
  const manifestPath = resolve(root, "packages/chain-manifest/deployments/anvil.json");
  if (!existsSync(manifestPath)) return null;
  const m = JSON.parse(readFileSync(manifestPath, "utf8"));
  return m.randomnessBeacon && m.randomnessBeacon !== "null" ? m.randomnessBeacon : null;
}

async function deployFreshBeacon(wallet, publicClient) {
  if (!existsSync(beaconBytecodeArtifact)) {
    fail("Missing forge artifact — run: cd contracts && forge build");
  }
  const art = JSON.parse(readFileSync(beaconBytecodeArtifact, "utf8"));
  const bytecode = art.bytecode?.object;
  if (!bytecode || bytecode === "0x") fail("RandomnessBeaconV2 bytecode missing");

  const hash = await wallet.deployContract({
    abi: beaconAbi,
    bytecode,
    args: [wallet.account.address, true],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const addr = receipt.contractAddress;
  if (!addr) fail("deploy returned no contractAddress");
  const setOp = await wallet.writeContract({
    address: addr,
    abi: beaconAbi,
    functionName: "setOperator",
    args: [wallet.account.address],
  });
  await publicClient.waitForTransactionReceipt({ hash: setOp });
  ok(`Deployed RandomnessBeaconV2 (mock on) ${addr}`);
  return addr;
}

async function resolveDeckRoots() {
  if (!withDeck) {
    return {
      mode: "fixture",
      secretRoot: SECRET_ROOT,
      deckBatchRoot: FIXTURE_DECK_BATCH,
      attestationHash: FIXTURE_ATTESTATION,
      deckBatchBind: null,
      hands: 0,
    };
  }

  const deck = await import("../packages/dealer-deck/src/index.ts");
  const secrets = [deck.fixtureDealerSecret(0), deck.fixtureDealerSecret(1)];
  const batch = deck.prepareDeckBatch({
    sessionId: SESSION_ID,
    randomnessEpoch: EPOCH,
    vrfR: VRF_RESULT,
    secrets,
    saltMode: "fixture",
  });
  const attestationHash = keccak256(
    toBytes(`wp052-attestation:${batch.deckBatchRoot}`),
  );
  return {
    mode: "dealer-deck",
    secretRoot: batch.dealerSecretRoot,
    deckBatchRoot: batch.deckBatchRoot,
    attestationHash,
    deckBatchBind: batch.deckBatchBind,
    hands: batch.hands.length,
  };
}

async function main() {
  console.log("\n=== WP-052 Mock VRF Anvil (RandomnessBeaconV2) ===\n");
  await checkRpc();

  const account = privateKeyToAccount(PK.startsWith("0x") ? PK : `0x${PK}`);
  const publicClient = createPublicClient({ chain: anvil, transport: http(RPC) });
  const wallet = createWalletClient({ account, chain: anvil, transport: http(RPC) });

  let beacon =
    env.RANDOMNESS_BEACON_ADDRESS ||
    loadManifestBeacon() ||
    null;

  if (!beacon || deployBeacon) {
    if (!beacon) console.log("No randomnessBeacon in manifest/env — deploying fresh…");
    beacon = await deployFreshBeacon(wallet, publicClient);
  } else {
    ok(`Using beacon ${beacon}`);
  }

  const mockOn = await publicClient.readContract({
    address: beacon,
    abi: beaconAbi,
    functionName: "mockVrfEnabled",
  });
  if (!mockOn) fail("mockVrfEnabled=false — use DeployLocal or setMockVrfEnabled(true)");
  ok("mockVrfEnabled=true");

  const roots = await resolveDeckRoots();
  ok(`Roots mode: ${roots.mode}${roots.hands ? ` (${roots.hands} hands)` : ""}`);

  console.log("\n  sessionId:", SESSION_ID);
  console.log("  epoch:    ", EPOCH.toString());
  console.log("  secretRoot:", roots.secretRoot);
  console.log("  vrfResult:", VRF_RESULT);
  console.log("  deckBatch:", roots.deckBatchRoot);

  // Unique session per run when reusing a live beacon (secret roots cannot be reused).
  // Default salt is stable; if epoch already registered, bump salt via env or --deploy-beacon.
  const existing = await publicClient.readContract({
    address: beacon,
    abi: beaconAbi,
    functionName: "getEpoch",
    args: [SESSION_ID, EPOCH],
  });
  if (existing.phase !== 0) {
    fail(
      `Epoch already used (phase=${existing.phase}). Re-run with MOCK_VRF_SESSION_SALT=<new> or --deploy-beacon`,
    );
  }

  let hash = await wallet.writeContract({
    address: beacon,
    abi: beaconAbi,
    functionName: "commitSecretRoot",
    args: [SESSION_ID, EPOCH, roots.secretRoot, PARTICIPANT_ROOT, GAME_TEMPLATE],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  ok("commitSecretRoot → SecretCommitted");

  hash = await wallet.writeContract({
    address: beacon,
    abi: beaconAbi,
    functionName: "requestVrf",
    args: [SESSION_ID, EPOCH],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  ok("requestVrf → VrfRequested");

  hash = await wallet.writeContract({
    address: beacon,
    abi: beaconAbi,
    functionName: "fulfillMock",
    args: [SESSION_ID, EPOCH, VRF_RESULT],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  ok("fulfillMock → VrfFulfilled");

  hash = await wallet.writeContract({
    address: beacon,
    abi: beaconAbi,
    functionName: "registerDeckBatch",
    args: [SESSION_ID, EPOCH, roots.deckBatchRoot, roots.attestationHash],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  ok("registerDeckBatch → DeckBatchRegistered");

  const epoch = await publicClient.readContract({
    address: beacon,
    abi: beaconAbi,
    functionName: "getEpoch",
    args: [SESSION_ID, EPOCH],
  });

  // Phase enum: None=0 … DeckBatchRegistered=4
  if (epoch.phase !== 4) fail(`expected phase DeckBatchRegistered(4), got ${epoch.phase}`);
  if (epoch.vrfResult.toLowerCase() !== VRF_RESULT.toLowerCase()) fail("vrfResult mismatch");
  if (!epoch.usedMockVrf) fail("usedMockVrf should be true");
  if (epoch.deckBatchRoot.toLowerCase() !== roots.deckBatchRoot.toLowerCase()) {
    fail("deckBatchRoot mismatch");
  }
  if (epoch.committedAt > epoch.requestedAt || epoch.requestedAt > epoch.fulfilledAt) {
    fail("timestamp ordering violated (secret must precede VRF)");
  }

  const onchainBind = await publicClient.readContract({
    address: beacon,
    abi: beaconAbi,
    functionName: "computeDeckBatchBind",
    args: [SESSION_ID, EPOCH, roots.deckBatchRoot],
  });
  if (epoch.deckBatchBind.toLowerCase() !== onchainBind.toLowerCase()) {
    fail("deckBatchBind mismatch vs computeDeckBatchBind");
  }
  if (roots.deckBatchBind && roots.deckBatchBind.toLowerCase() !== onchainBind.toLowerCase()) {
    fail("dealer-deck deckBatchBind diverges from on-chain DOMAIN_DECK_BATCH_V1 bind");
  }

  ok("On-chain epoch record verified");

  const out = {
    workPacket: "WP-052",
    beacon,
    sessionId: SESSION_ID,
    randomnessEpoch: EPOCH.toString(),
    rootsMode: roots.mode,
    dealerSecretRoot: roots.secretRoot,
    vrfResult: VRF_RESULT,
    vrfRequestId: epoch.vrfRequestId.toString(),
    deckBatchRoot: roots.deckBatchRoot,
    deckBatchBind: epoch.deckBatchBind,
    dealerAttestationHash: roots.attestationHash,
    usedMockVrf: epoch.usedMockVrf,
    phase: "DeckBatchRegistered",
    timestamps: {
      committedAt: epoch.committedAt.toString(),
      requestedAt: epoch.requestedAt.toString(),
      fulfilledAt: epoch.fulfilledAt.toString(),
      deckBatchAt: epoch.deckBatchAt.toString(),
    },
  };

  const outPath = resolve(root, "scripts/.anvil-mock-vrf-last.json");
  writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`);
  ok(`Wrote ${outPath}`);

  console.log(`
=== How dealers / services consume this locally ===

1. Dealer commits secrets off-chain → dealerSecretRoot (WP-051 @mozetto/dealer-deck).
2. Operator calls commitSecretRoot on RandomnessBeaconV2 (mock VRF enabled on Anvil).
3. Operator requestVrf → fulfillMock(sessionId, epoch, vrfResult)  [Anvil only].
4. Dealer reads getEpoch(...).vrfResult and builds handSeeds / decks:
     handSeedV2({ secret, vrfR: vrfResult, sessionId, epoch, index })
     prepareDeckBatch({ sessionId, randomnessEpoch, vrfR, secrets })
5. Operator registerDeckBatch(deckBatchRoot, attestationHash).
6. Game / settlement mirror roots; SessionLifecycle stubs remain events-only (WP-023).

Legacy settlement-worker ENABLE_MOCK_VRF=1 still targets RandomnessCoordinatorV1 —
prefer Beacon V2 + this script for Protocol V3 local randomness.

Re-run: MOCK_VRF_SESSION_SALT=wp052-run-2 pnpm e2e:mock-vrf
With deck lib: pnpm e2e:mock-vrf -- --with-deck
`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}).then(() => {
  process.exit(0);
});
