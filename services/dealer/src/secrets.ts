import { randomBytes } from "node:crypto";
import { keccak256, toBytes, type Hex } from "viem";
import {
  buildDealerSecretRoot,
  buildSecretLeaves,
  handSeedV2,
  prepareHandDeck,
  type PreparedHandDeck,
} from "@mozetto/dealer-deck";
import { deriveHandId } from "@mozetto/protocol-vectors";

export type DealerBatch = {
  sessionId: string;
  sessionIdBytes32: Hex;
  randomnessEpoch: bigint;
  secrets: Hex[];
  leaves: Hex[];
  dealerRoot: Hex;
  createdAt: number;
};

const batches = new Map<string, DealerBatch>();

const DEFAULT_BATCH_SIZE = 256;

export function sessionIdToBytes32(sessionId: string): Hex {
  if (/^0x[0-9a-fA-F]{64}$/.test(sessionId)) return sessionId.toLowerCase() as Hex;
  const hex = sessionId.startsWith("0x") ? sessionId.slice(2) : sessionId;
  if (/^[0-9a-fA-F]{64}$/.test(hex)) return (`0x${hex.toLowerCase()}`) as Hex;
  return keccak256(toBytes(sessionId));
}

export function getBatch(sessionId: string): DealerBatch | undefined {
  return batches.get(sessionId);
}

export function createBatch(
  sessionId: string,
  opts: { randomnessEpoch?: bigint; secretCount?: number } = {},
): DealerBatch {
  const randomnessEpoch = opts.randomnessEpoch ?? 0n;
  const secretCount = opts.secretCount ?? DEFAULT_BATCH_SIZE;
  const sessionIdBytes32 = sessionIdToBytes32(sessionId);
  const secrets: Hex[] = [];
  for (let i = 0; i < secretCount; i++) {
    secrets.push((`0x${randomBytes(32).toString("hex")}`) as Hex);
  }
  const leaves = buildSecretLeaves(sessionIdBytes32, randomnessEpoch, secrets);
  const dealerRoot = buildDealerSecretRoot(leaves);
  const batch: DealerBatch = {
    sessionId,
    sessionIdBytes32,
    randomnessEpoch,
    secrets,
    leaves,
    dealerRoot,
    createdAt: Date.now(),
  };
  batches.set(sessionId, batch);
  return batch;
}

/** Season-1 Randomness V2 handSeed (keccak ABI — not HKDF). */
export function deriveHandSeed(opts: {
  sessionId: string;
  handNumber: number;
  vrfWord: string;
  secretIndex: number;
  batch: DealerBatch;
}): Hex {
  const { secretIndex, batch } = opts;
  if (secretIndex < 0 || secretIndex >= batch.secrets.length) {
    throw new Error("secretIndex out of range");
  }
  const vrfR = normalizeBytes32(opts.vrfWord);
  return handSeedV2({
    secret: batch.secrets[secretIndex]!,
    vrfR,
    sessionId: batch.sessionIdBytes32,
    epoch: batch.randomnessEpoch,
    index: secretIndex,
  });
}

export function prepareDeckForHand(opts: {
  batch: DealerBatch;
  handNumber: number;
  vrfWord: string;
  secretIndex: number;
}): PreparedHandDeck {
  const handSeed = deriveHandSeed({
    sessionId: opts.batch.sessionId,
    handNumber: opts.handNumber,
    vrfWord: opts.vrfWord,
    secretIndex: opts.secretIndex,
    batch: opts.batch,
  });
  const handId = deriveHandId(
    opts.batch.sessionIdBytes32,
    opts.batch.randomnessEpoch,
    BigInt(opts.handNumber),
  ).hash;
  return prepareHandDeck({
    handId,
    handSeed,
    index: opts.secretIndex,
    saltMode: "production",
  });
}

function normalizeBytes32(raw: string): Hex {
  if (/^0x[0-9a-fA-F]{64}$/.test(raw)) return raw.toLowerCase() as Hex;
  const hex = raw.startsWith("0x") ? raw.slice(2) : raw;
  if (/^[0-9a-fA-F]{64}$/.test(hex)) return (`0x${hex.toLowerCase()}`) as Hex;
  return keccak256(toBytes(raw));
}
