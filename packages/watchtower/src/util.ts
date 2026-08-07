import type { Hex } from "viem";

export const ZERO_ROOT =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex;

export function asHex(v: unknown, label = "hex"): Hex {
  if (typeof v !== "string" || !v.startsWith("0x")) {
    throw new Error(`expected ${label} hex string, got ${typeof v}`);
  }
  return v.toLowerCase() as Hex;
}

export function asBigInt(v: unknown): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return BigInt(v);
  if (typeof v === "string") return BigInt(v);
  throw new Error(`expected bigint-ish, got ${typeof v}`);
}

export function eqHex(a: Hex, b: Hex): boolean {
  return a.toLowerCase() === b.toLowerCase();
}
