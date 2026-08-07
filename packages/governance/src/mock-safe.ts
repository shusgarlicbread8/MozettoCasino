import type { Address } from "viem";
import { MOCK_PROTOCOL_SAFE, MOCK_TREASURY_SAFE } from "./safe.js";
import type { MockSafeConfig, SafeTxData } from "./types.js";

/** Deterministic Anvil-style mock owners (no keys; addresses only). */
export const MOCK_SAFE_OWNERS: Address[] = [
  "0x1111111111111111111111111111111111111111",
  "0x2222222222222222222222222222222222222222",
  "0x3333333333333333333333333333333333333333",
  "0x4444444444444444444444444444444444444444",
  "0x5555555555555555555555555555555555555555",
];

export function createMockProtocolSafe(chainId = 31337): MockSafeConfig {
  return {
    address: MOCK_PROTOCOL_SAFE,
    threshold: 3,
    owners: MOCK_SAFE_OWNERS,
    chainId,
    label: "Mock Protocol Safe (local — not deployed on mainnet)",
  };
}

export function createMockTreasurySafe(chainId = 31337): MockSafeConfig {
  return {
    address: MOCK_TREASURY_SAFE,
    threshold: 3,
    owners: MOCK_SAFE_OWNERS.slice(0, 3),
    chainId,
    label: "Mock Treasury Safe (local — receive-only role)",
  };
}

/**
 * Offline "proposal receipt" for local dry-runs. Does not sign or broadcast.
 * Signers use Safe UI / hardware wallets / CLI outside the admin browser.
 */
export function mockSafePropose(safe: MockSafeConfig, tx: SafeTxData): {
  safeAddress: Address;
  threshold: number;
  owners: Address[];
  tx: SafeTxData;
  status: "awaiting_signatures";
  signedBy: Address[];
  containsPrivateKeys: false;
  instructions: string[];
} {
  return {
    safeAddress: safe.address,
    threshold: safe.threshold,
    owners: safe.owners,
    tx,
    status: "awaiting_signatures",
    signedBy: [],
    containsPrivateKeys: false,
    instructions: [
      `Import Safe Transaction Builder JSON into Safe ${safe.address} (or queue via Transaction Service).`,
      `Collect ${safe.threshold}-of-${safe.owners.length} owner signatures offline (hardware wallet / Safe mobile).`,
      "Never paste owner private keys into the admin browser or this CLI stdout pipeline.",
      "After Safe execution, wait for any contract-internal minDelay before execute* steps.",
    ],
  };
}
