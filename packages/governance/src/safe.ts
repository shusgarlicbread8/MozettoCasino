import type { Address, Hex } from "viem";
import type { EncodedCall, SafeTxBuilderBatch, SafeTxData } from "./types.js";

/** Local / Anvil stand-in Protocol Safe (deterministic, not a real deployed Safe). */
export const MOCK_PROTOCOL_SAFE: Address = "0x5AFE000000000000000000000000000000000001";

/** Local / Anvil stand-in Treasury Safe. */
export const MOCK_TREASURY_SAFE: Address = "0x7EA5110000000000000000000000000000000001";

export function toSafeTx(call: EncodedCall): SafeTxData {
  return {
    to: call.to,
    value: call.value,
    data: call.data,
    operation: 0,
  };
}

export function buildSafeTxBuilderBatch(input: {
  chainId: number;
  name: string;
  description: string;
  safeAddress?: Address;
  calls: EncodedCall[];
}): SafeTxBuilderBatch {
  return {
    version: "1.0",
    chainId: String(input.chainId),
    createdAt: Math.floor(Date.now() / 1000),
    meta: {
      name: input.name,
      description: input.description,
      txBuilderVersion: "1.16.5",
      ...(input.safeAddress ? { createdFromSafeAddress: input.safeAddress } : {}),
    },
    transactions: input.calls.map((c) => ({
      to: c.to,
      value: c.value,
      data: c.data,
    })),
  };
}

/**
 * Resolve Protocol Safe address for proposal metadata.
 * Never returns or accepts a private key — address only.
 */
export function resolveProtocolSafeAddress(override?: Address | null): Address {
  const env = process.env.PROTOCOL_SAFE_ADDRESS;
  if (override) return override;
  if (env && /^0x[a-fA-F0-9]{40}$/.test(env)) return env as Address;
  return MOCK_PROTOCOL_SAFE;
}

export function resolveTreasurySafeAddress(override?: Address | null): Address {
  const env = process.env.TREASURY_SAFE_ADDRESS;
  if (override) return override;
  if (env && /^0x[a-fA-F0-9]{40}$/.test(env)) return env as Address;
  return MOCK_TREASURY_SAFE;
}

/** Reject blobs that embed private-key env assignments (calldata hex alone is fine). */
export function assertNoPrivateKeyMaterial(blob: string): void {
  if (/(?:PRIVATE_KEY|SECRET_KEY|MNEMONIC|xprv)\s*[:=]\s*\S+/i.test(blob)) {
    throw new Error("Refusing to process blob that appears to contain private key material");
  }
}

export function summarizeSafeTx(tx: SafeTxData): { to: Address; value: string; dataPrefix: Hex; dataLength: number } {
  return {
    to: tx.to,
    value: tx.value,
    dataPrefix: (tx.data.slice(0, 10) as Hex) || "0x",
    dataLength: (tx.data.length - 2) / 2,
  };
}
