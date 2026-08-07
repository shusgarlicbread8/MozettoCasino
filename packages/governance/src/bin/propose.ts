#!/usr/bin/env node
/**
 * CLI: build Safe / TimelockController proposals without loading private keys.
 *
 * Usage:
 *   pnpm --filter @mozetto/governance propose -- \
 *     --action gameRegistry.setMinDelay \
 *     --to 0x... \
 *     --arg newDelay=172800 \
 *     --chain-id 31337 \
 *     [--mode direct|timelockController] \
 *     [--timelock 0x...] \
 *     [--delay 86400] \
 *     [--safe 0x...] \
 *     [--mock-receipt]
 *
 * Target defaults from chain-manifest when --to omitted (if address is known).
 */
import {
  ACTION_CATALOG,
  buildGovernanceProposal,
  createMockProtocolSafe,
  defaultTargetForAction,
  listActionIds,
  mockSafePropose,
  resolveGovernanceTargets,
  type ActionId,
  type ProposalMode,
} from "../index.js";

function usage(): never {
  console.error(`mozetto-propose — Safe/timelock calldata builder (no private keys)

Actions:
${ACTION_CATALOG.map((a) => `  ${a.id}`).join("\n")}

Example:
  pnpm --filter @mozetto/governance propose -- \\
    --action protocolFeeVault.scheduleTreasuryUpdate \\
    --arg newTreasury=0x7EA5110000000000000000000000000000000001 \\
    --chain-id 31337 --mock-receipt
`);
  process.exit(1);
}

function parseArgs(argv: string[]) {
  const out: {
    action?: string;
    to?: string;
    chainId?: number;
    mode: ProposalMode;
    timelock?: string;
    delay?: number;
    safe?: string;
    mockReceipt: boolean;
    args: Record<string, string>;
  } = { mode: "direct", mockReceipt: false, args: {} };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") usage();
    if (a === "--action") out.action = argv[++i];
    else if (a === "--to") out.to = argv[++i];
    else if (a === "--chain-id") out.chainId = Number(argv[++i]);
    else if (a === "--mode") out.mode = argv[++i] as ProposalMode;
    else if (a === "--timelock") out.timelock = argv[++i];
    else if (a === "--delay") out.delay = Number(argv[++i]);
    else if (a === "--safe") out.safe = argv[++i];
    else if (a === "--mock-receipt") out.mockReceipt = true;
    else if (a === "--arg") {
      const pair = argv[++i] ?? "";
      const eq = pair.indexOf("=");
      if (eq <= 0) throw new Error(`Bad --arg ${pair} (expected key=value)`);
      out.args[pair.slice(0, eq)] = pair.slice(eq + 1);
    } else if (a === "--") continue;
    else throw new Error(`Unknown flag: ${a}`);
  }
  return out;
}

function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed.action) usage();
  if (!listActionIds().includes(parsed.action as ActionId)) {
    console.error(`Unknown action: ${parsed.action}`);
    usage();
  }

  const targets = resolveGovernanceTargets();
  const chainId = parsed.chainId ?? targets.chainId;
  const actionId = parsed.action as ActionId;
  const to =
    (parsed.to as `0x${string}` | undefined) ??
    defaultTargetForAction(actionId, targets) ??
    undefined;

  if (!to) {
    console.error(
      `No --to and no manifest address for ${actionId}. Pass --to 0x… explicitly.`,
    );
    process.exit(2);
  }

  const proposal = buildGovernanceProposal({
    actionId,
    to,
    args: parsed.args,
    chainId,
    mode: parsed.mode,
    timelockAddress: parsed.timelock as `0x${string}` | undefined,
    timelockDelaySec: parsed.delay,
    safeAddress: parsed.safe as `0x${string}` | undefined,
  });

  const output: Record<string, unknown> = {
    proposal,
    signingReminder:
      "Sign only in Safe UI / hardware wallet / offline CLI. This tool never loads PRIVATE_KEY.",
  };

  if (parsed.mockReceipt) {
    output.mockReceipt = mockSafePropose(createMockProtocolSafe(chainId), proposal.safeTx);
  }

  console.log(JSON.stringify(output, null, 2));
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
