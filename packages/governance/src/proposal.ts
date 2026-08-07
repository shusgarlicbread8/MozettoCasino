import type { Address, Hex } from "viem";
import { encodeOwnerAction } from "./encode.js";
import {
  assertNoPrivateKeyMaterial,
  buildSafeTxBuilderBatch,
  resolveProtocolSafeAddress,
  toSafeTx,
} from "./safe.js";
import { wrapWithTimelockSchedule } from "./timelock.js";
import type { BuildProposalInput, GovernanceProposal } from "./types.js";
import { getCatalogEntry } from "./catalog.js";

export function buildGovernanceProposal(input: BuildProposalInput): GovernanceProposal {
  const mode = input.mode ?? "direct";
  const catalog = getCatalogEntry(input.actionId);
  const inner = encodeOwnerAction(input.actionId, input.to, input.args);
  const safeAddress = resolveProtocolSafeAddress(input.safeAddress);

  let safeCall = inner;
  const notes: string[] = [
    "Admin UI / CLI only build calldata — signing happens in Safe / hardware wallets.",
    `Protocol Safe (metadata): ${safeAddress}`,
    `Flow: proposal → Safe approval → ${mode === "timelockController" ? "TimelockController delay → " : ""}execution`,
  ];

  if (catalog?.notes) notes.push(catalog.notes);
  if (inner.contractTimelocked) {
    notes.push(
      "This call starts a contract-internal timelock; a second execute* proposal is required after eta.",
    );
  }

  if (mode === "timelockController") {
    if (!input.timelockAddress) {
      throw new Error("mode=timelockController requires timelockAddress");
    }
    const delay = input.timelockDelaySec ?? 86400;
    safeCall = wrapWithTimelockSchedule(input.timelockAddress, inner, delay, {
      salt: input.timelockSalt,
      predecessor: input.timelockPredecessor,
    });
    notes.push(
      `Safe targets TimelockController ${input.timelockAddress} with delay=${delay}s.`,
    );
    notes.push("After delay, build a separate timelock.execute proposal with the same salt/data.");
  }

  const name = input.name ?? `Mozetto ${input.actionId}`;
  const description =
    input.description ??
    `${inner.description}${mode === "timelockController" ? " (via TimelockController)" : ""}`;

  const safeTx = toSafeTx(safeCall);
  const safeTxBuilder = buildSafeTxBuilderBatch({
    chainId: input.chainId,
    name,
    description,
    safeAddress,
    calls: [safeCall],
  });

  const proposal: GovernanceProposal = {
    actionId: input.actionId,
    chainId: input.chainId,
    mode,
    inner,
    safeTx,
    safeTxBuilder,
    notes,
    containsPrivateKeys: false,
  };

  assertNoPrivateKeyMaterial(JSON.stringify(proposal));
  return proposal;
}

/** Convenience: encode only (no Safe batch wrapper). */
export function encodeCriticalCalldata(
  actionId: BuildProposalInput["actionId"],
  to: Address,
  args: Record<string, unknown> = {},
): { to: Address; data: Hex; description: string } {
  const encoded = encodeOwnerAction(actionId, to, args);
  return { to: encoded.to, data: encoded.data, description: encoded.description };
}
