import type { GovernancePreviewArtifact } from "./preview.js";
import { assertNoPrivateKeyMaterial } from "./safe.js";
import type { SafeTxBuilderBatch } from "./types.js";

/** MC-093 — Safe Transaction Builder export v2 (hashes + explicit no-key flag). */
export type SafeExportV2 = {
  version: "2.0";
  containsPrivateKeys: false;
  chainId: number;
  actionId: string;
  calldataHash: string;
  safeJsonHash: string;
  safeTxBuilder: SafeTxBuilderBatch;
  exportNotes: string[];
};

export function buildSafeExportV2(artifact: GovernancePreviewArtifact): SafeExportV2 {
  const payload: SafeExportV2 = {
    version: "2.0",
    containsPrivateKeys: false,
    chainId: artifact.proposal.chainId,
    actionId: artifact.proposal.actionId,
    calldataHash: artifact.calldataHash,
    safeJsonHash: artifact.safeJsonHash,
    safeTxBuilder: artifact.proposal.safeTxBuilder,
    exportNotes: [
      "Import safeTxBuilder into Safe Transaction Builder — signing stays outside Control.",
      "No private keys in this export.",
      `Calldata hash: ${artifact.calldataHash}`,
      `Safe JSON hash: ${artifact.safeJsonHash}`,
    ],
  };
  assertNoPrivateKeyMaterial(JSON.stringify(payload));
  return payload;
}
