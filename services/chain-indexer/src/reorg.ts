/**
 * Reorg detection: compare stored chain_events.block_hash against live chain.
 * On mismatch: mark removed, rewind deposit mirrors, reset cursor to reorg point.
 */
import { query } from "@mozetto/database";
import type { Hex } from "viem";
import { setCursor } from "./cursor.js";
import { isReorgMismatch, metrics } from "./metrics.js";
import { rewindDepositsFromBlock } from "./money.js";
import { markEventsRemovedFromBlock } from "./persist.js";

export type ReorgResult =
  | { reorg: false }
  | { reorg: true; fromBlock: bigint; mismatchedBlock: bigint };

type BlockHashClient = {
  getBlock: (args: { blockNumber: bigint }) => Promise<{ hash: string }>;
};

/**
 * Scan recent indexed blocks for hash mismatches.
 * Returns earliest mismatched block when found.
 */
export async function detectReorg(
  chainId: number,
  client: BlockHashClient,
  cursorBlock: bigint,
  lookback: number,
): Promise<ReorgResult> {
  if (cursorBlock <= 0n || lookback <= 0) return { reorg: false };

  const from = cursorBlock > BigInt(lookback) ? cursorBlock - BigInt(lookback) : 0n;
  const samples = await query<{ block_number: string; block_hash: string }>(
    `select distinct on (block_number) block_number::text, block_hash
     from chain_events
     where chain_id = $1
       and block_number >= $2
       and block_number <= $3
       and removed = false
       and block_hash is not null
     order by block_number asc, created_at desc`,
    [chainId, from.toString(), cursorBlock.toString()],
  );

  for (const row of samples.rows) {
    const bn = BigInt(row.block_number);
    let chainHash: string | null = null;
    try {
      const block = await client.getBlock({ blockNumber: bn });
      chainHash = block.hash;
    } catch {
      // Block may have disappeared entirely in a deep reorg.
      chainHash = null;
    }
    if (!chainHash || isReorgMismatch(row.block_hash, chainHash)) {
      return { reorg: true, fromBlock: bn, mismatchedBlock: bn };
    }
  }
  return { reorg: false };
}

export async function applyReorg(
  chainId: number,
  vault: Hex,
  fromBlock: bigint,
  detail: Record<string, unknown>,
): Promise<void> {
  const rewindTo = fromBlock > 0n ? fromBlock - 1n : 0n;
  await query(
    `insert into chain_reorgs (chain_id, from_block, detail)
     values ($1, $2, $3::jsonb)`,
    [chainId, fromBlock.toString(), JSON.stringify(detail)],
  );
  const marked = await markEventsRemovedFromBlock(chainId, fromBlock);
  const rewound = await rewindDepositsFromBlock(chainId, fromBlock);
  await setCursor(chainId, rewindTo, 0);
  metrics.noteReorg();
  console.warn(
    `[indexer] REORG chain=${chainId} fromBlock=${fromBlock} marked=${marked} depositsRewound=${rewound} cursor→${rewindTo} vault=${vault}`,
  );
}

/**
 * Pure decision helper for tests: given stored vs chain hashes by block, find reorg start.
 */
export function findReorgStart(
  pairs: Array<{ block: bigint; stored: string; chain: string | null }>,
): bigint | null {
  for (const p of pairs) {
    if (!p.chain || isReorgMismatch(p.stored, p.chain)) return p.block;
  }
  return null;
}
