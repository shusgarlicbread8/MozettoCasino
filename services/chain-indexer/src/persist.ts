import { query } from "@mozetto/database";
import type { Log } from "viem";

export async function persistEvent(
  chainId: number,
  log: Log,
  eventName: string,
  args: Record<string, unknown>,
) {
  await query(
    `insert into chain_events
       (chain_id, tx_hash, log_index, block_number, block_hash, address, event_name, args, removed)
     values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)
     on conflict (chain_id, tx_hash, log_index) do update
       set removed = excluded.removed, args = excluded.args, block_hash = excluded.block_hash`,
    [
      chainId,
      log.transactionHash,
      log.logIndex ?? 0,
      (log.blockNumber ?? 0n).toString(),
      log.blockHash,
      log.address,
      eventName,
      JSON.stringify(args, (_, v) => (typeof v === "bigint" ? v.toString() : v)),
      Boolean(log.removed),
    ],
  );
}

export async function markEventsRemovedFromBlock(
  chainId: number,
  fromBlock: bigint,
): Promise<number> {
  const res = await query(
    `update chain_events
     set removed = true
     where chain_id = $1 and block_number >= $2 and removed = false`,
    [chainId, fromBlock.toString()],
  );
  return res.rowCount ?? 0;
}
