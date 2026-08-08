import { createHash } from "node:crypto";
import type { Hex } from "viem";

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export function hashCalldata(data: Hex): string {
  return sha256Hex(data.toLowerCase());
}

export function hashSafeJson(json: unknown): string {
  return sha256Hex(JSON.stringify(json));
}
