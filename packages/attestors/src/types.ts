import type { Address, Hex } from "viem";
import type { FinalSettlementInput } from "@mozetto/root-builder";

/** Season-1 attestor roles — never share keys across roles. */
export type AttestorRole = "game" | "dealer" | "replay";

export const ATTESTOR_ROLES: readonly AttestorRole[] = ["game", "dealer", "replay"] as const;

/** Env var that holds the private key for each role. */
export const ATTESTOR_ENV_KEYS: Record<AttestorRole, string> = {
  game: "GAME_ATTESTOR_PRIVATE_KEY",
  dealer: "DEALER_ATTESTOR_PRIVATE_KEY",
  replay: "REPLAY_ATTESTOR_PRIVATE_KEY",
};

export type AttestorKeyMaterial = {
  role: AttestorRole;
  privateKey: Hex;
  address: Address;
  envKey: string;
};

export type AttestorBundle = {
  game: AttestorKeyMaterial;
  dealer: AttestorKeyMaterial;
  replay: AttestorKeyMaterial;
};

export type LoadKeysOptions = {
  /**
   * When true, refuse if any two role keys are identical (same private key or address).
   * Defaults to `isProductionAttestorMode(env)`.
   */
  requireDistinct?: boolean;
  /** Require all three roles present. Default true. */
  requireAll?: boolean;
};

/** FinalSettlementV3 fields + EIP-712 domain (vector 12 / MOZETTO_SETTLEMENT_V3). */
export type FinalSettlementV3Message = FinalSettlementInput;

export type Attestation = {
  role: AttestorRole;
  address: Address;
  signature: Hex;
  digest: Hex;
};
