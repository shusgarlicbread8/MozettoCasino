import { randomBytes, hkdfSync, createHash } from "node:crypto";
import type { Hex } from "viem";
import { merkleRoot, secretLeaf } from "./merkle.js";

export type DealerBatch = {
  sessionId: string;
  secrets: Hex[];
  leaves: Hex[];
  dealerRoot: Hex;
  createdAt: number;
};

const batches = new Map<string, DealerBatch>();

export function getBatch(sessionId: string): DealerBatch | undefined {
  return batches.get(sessionId);
}

export function createBatch(sessionId: string): DealerBatch {
  const secrets: Hex[] = [];
  const leaves: Hex[] = [];
  for (let i = 0; i < 256; i++) {
    const secret = (`0x${randomBytes(32).toString("hex")}`) as Hex;
    secrets.push(secret);
    leaves.push(secretLeaf(secret));
  }
  const dealerRoot = merkleRoot(leaves);
  const batch: DealerBatch = { sessionId, secrets, leaves, dealerRoot, createdAt: Date.now() };
  batches.set(sessionId, batch);
  return batch;
}

/** HKDF-SHA256 hand seed from dealer secret + VRF word (mozetto-poker-v1). */
export function deriveHandSeed(opts: {
  sessionId: string;
  handNumber: number;
  vrfWord: string;
  secretIndex: number;
  batch: DealerBatch;
}): string {
  const { sessionId, handNumber, vrfWord, secretIndex, batch } = opts;
  if (secretIndex < 0 || secretIndex >= batch.secrets.length) {
    throw new Error("secretIndex out of range");
  }
  const secretHex = batch.secrets[secretIndex]!.slice(2);
  const salt = createHash("sha256")
    .update(`mozetto-poker-v1:${sessionId}:${handNumber}:${vrfWord}`)
    .digest();
  const info = Buffer.from(`hand-seed:${sessionId}:${handNumber}`, "utf8");
  const ikm = Buffer.from(secretHex, "hex");
  const okm = hkdfSync("sha256", ikm, salt, info, 32);
  return Buffer.from(okm).toString("hex");
}
