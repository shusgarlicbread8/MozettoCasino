import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Hex } from "viem";
import type { CheckResult } from "./types.js";

export function loadJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function asHex(v: unknown, label: string): Hex {
  if (typeof v !== "string" || !v.startsWith("0x")) {
    throw new Error(`${label}: expected 0x-hex, got ${String(v)}`);
  }
  return v as Hex;
}

export function check(
  id: string,
  ok: boolean,
  detail: string,
): CheckResult {
  return { id, ok, detail };
}

export function vectorPath(vectorsDir: string, name: string): string {
  return join(vectorsDir, name);
}
