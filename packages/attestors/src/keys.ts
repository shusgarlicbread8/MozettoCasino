import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import {
  ATTESTOR_ENV_KEYS,
  ATTESTOR_ROLES,
  type AttestorBundle,
  type AttestorKeyMaterial,
  type AttestorRole,
  type LoadKeysOptions,
} from "./types.js";

export class AttestorKeyError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "AttestorKeyError";
    this.code = code;
  }
}

function normalizePrivateKey(raw: string, envKey: string): Hex {
  const trimmed = raw.trim();
  const with0x = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(with0x)) {
    throw new AttestorKeyError(
      "INVALID_PRIVATE_KEY",
      `${envKey} must be a 32-byte hex private key`,
    );
  }
  return with0x.toLowerCase() as Hex;
}

/**
 * Production / high-stakes mode: identical role keys are refused.
 * Triggers on NODE_ENV=production, MOZETTO_PRODUCTION=1, ATTESTOR_REQUIRE_DISTINCT_KEYS=1,
 * MOZETTO_ENV in {production,mainnet,sepolia}, or Base mainnet CHAIN_ID=8453.
 */
export function isProductionAttestorMode(
  env: NodeJS.Dict<string | undefined> = process.env,
): boolean {
  if (env.ATTESTOR_REQUIRE_DISTINCT_KEYS === "1" || env.ATTESTOR_REQUIRE_DISTINCT_KEYS === "true") {
    return true;
  }
  if (env.MOZETTO_PRODUCTION === "1" || env.MOZETTO_PRODUCTION === "true") {
    return true;
  }
  const nodeEnv = (env.NODE_ENV || "").toLowerCase();
  if (nodeEnv === "production") return true;
  const moz = (env.MOZETTO_ENV || "").toLowerCase();
  if (moz === "production" || moz === "mainnet" || moz === "sepolia") return true;
  const chainId = Number(env.CHAIN_ID || 0);
  if (chainId === 8453 || chainId === 1) return true;
  return false;
}

export function loadAttestorKey(
  role: AttestorRole,
  env: NodeJS.Dict<string | undefined> = process.env,
): AttestorKeyMaterial {
  const envKey = ATTESTOR_ENV_KEYS[role];
  const raw = env[envKey];
  if (!raw || !raw.trim()) {
    throw new AttestorKeyError("MISSING_KEY", `${envKey} is required for attestor role '${role}'`);
  }
  const privateKey = normalizePrivateKey(raw, envKey);
  const account = privateKeyToAccount(privateKey);
  return { role, privateKey, address: account.address, envKey };
}

export function tryLoadAttestorKey(
  role: AttestorRole,
  env: NodeJS.Dict<string | undefined> = process.env,
): AttestorKeyMaterial | null {
  const envKey = ATTESTOR_ENV_KEYS[role];
  const raw = env[envKey];
  if (!raw || !raw.trim()) return null;
  return loadAttestorKey(role, env);
}

/** Assert no two roles share the same private key or derived address. */
export function assertDistinctAttestorKeys(keys: readonly AttestorKeyMaterial[]): void {
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const a = keys[i]!;
      const b = keys[j]!;
      if (a.privateKey.toLowerCase() === b.privateKey.toLowerCase()) {
        throw new AttestorKeyError(
          "IDENTICAL_KEYS",
          `Attestor roles '${a.role}' and '${b.role}' share the same private key (${a.envKey} / ${b.envKey}). Never reuse keys across roles.`,
        );
      }
      if (a.address.toLowerCase() === b.address.toLowerCase()) {
        throw new AttestorKeyError(
          "IDENTICAL_ADDRESSES",
          `Attestor roles '${a.role}' and '${b.role}' resolve to the same address ${a.address}. Never reuse keys across roles.`,
        );
      }
    }
  }
}

/**
 * Load game / dealer / replay keys from env.
 * In production mode (or when `requireDistinct: true`), refuses identical keys.
 */
export function loadAttestorBundle(
  env: NodeJS.Dict<string | undefined> = process.env,
  opts: LoadKeysOptions = {},
): AttestorBundle {
  const requireAll = opts.requireAll !== false;
  const requireDistinct = opts.requireDistinct ?? isProductionAttestorMode(env);

  const loaded: AttestorKeyMaterial[] = [];
  for (const role of ATTESTOR_ROLES) {
    const key = tryLoadAttestorKey(role, env);
    if (!key) {
      if (requireAll) {
        throw new AttestorKeyError(
          "MISSING_KEY",
          `${ATTESTOR_ENV_KEYS[role]} is required (role '${role}')`,
        );
      }
      continue;
    }
    loaded.push(key);
  }

  if (requireDistinct && loaded.length >= 2) {
    assertDistinctAttestorKeys(loaded);
  }

  const byRole = Object.fromEntries(loaded.map((k) => [k.role, k])) as Partial<
    Record<AttestorRole, AttestorKeyMaterial>
  >;

  if (requireAll) {
    return {
      game: byRole.game!,
      dealer: byRole.dealer!,
      replay: byRole.replay!,
    };
  }

  // Partial load: callers must check presence.
  return {
    game: byRole.game as AttestorKeyMaterial,
    dealer: byRole.dealer as AttestorKeyMaterial,
    replay: byRole.replay as AttestorKeyMaterial,
  };
}

/**
 * Soft probe for workers: returns loaded roles + duplicate warning/error.
 * Never falls back to SETTLEMENT_PRIVATE_KEY (submitter ≠ attestor).
 */
export function probeAttestorKeys(env: NodeJS.Dict<string | undefined> = process.env): {
  loaded: AttestorKeyMaterial[];
  productionMode: boolean;
  duplicateError: AttestorKeyError | null;
} {
  const loaded: AttestorKeyMaterial[] = [];
  for (const role of ATTESTOR_ROLES) {
    const key = tryLoadAttestorKey(role, env);
    if (key) loaded.push(key);
  }
  const productionMode = isProductionAttestorMode(env);
  let duplicateError: AttestorKeyError | null = null;
  if (loaded.length >= 2) {
    try {
      assertDistinctAttestorKeys(loaded);
    } catch (e) {
      if (e instanceof AttestorKeyError) duplicateError = e;
      else throw e;
    }
  }
  if (duplicateError && productionMode) {
    throw duplicateError;
  }
  return { loaded, productionMode, duplicateError };
}
