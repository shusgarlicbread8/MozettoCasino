/**
 * Retire custody sessions that can never deal a hand — fewer than two seated
 * players, no hand ever dealt, and past the join window.
 *
 * Dry-run by default; pass --apply to actually retire them.
 *
 *   pnpm reap:orphans                       # show what would be retired (Anvil)
 *   pnpm reap:orphans --apply
 *   pnpm reap:orphans --chain 84532 --older-than 30 --apply
 */
import { findOrphanOnchainTables, reapOrphanOnchainTables } from "../src/onchain-match.js";

const argv = process.argv.slice(2);
const argOf = (name: string, fallback: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const chainId = Number(argOf("chain", "31337"));
const olderThanMinutes = Number(argOf("older-than", "10"));
const apply = argv.includes("--apply");

async function main() {
  const orphans = apply
    ? await reapOrphanOnchainTables({ chainId, olderThanMinutes })
    : await findOrphanOnchainTables({ chainId, olderThanMinutes });

  if (!orphans.length) {
    console.log(`No orphan tables on chain ${chainId} older than ${olderThanMinutes}m.`);
    return;
  }

  console.log(
    `${apply ? "Retired" : "Would retire"} ${orphans.length} orphan table(s) on chain ${chainId}:`,
  );
  for (const o of orphans) {
    console.log(
      `  ${o.tableId}  session=${o.sessionId.slice(0, 12)}…  status=${o.status}  players=${o.players}  age=${o.ageMinutes}m`,
    );
  }
  if (!apply) console.log("\nRe-run with --apply to retire them.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("reap-orphan-tables failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
