import { query } from "@mozetto/database";
import type { Hex } from "viem";
import { metrics } from "./metrics.js";

export async function ensureCursor(
  chainId: number,
  vault: Hex,
  deploymentBlock: bigint,
  chainHead: bigint,
  opts?: { forceRebuild?: boolean },
): Promise<bigint> {
  const existing = await query<{
    last_block: string;
    vault_address: string | null;
    deployment_block: string;
  }>(
    `select last_block::text, vault_address, coalesce(deployment_block, 0)::text as deployment_block
     from chain_cursors where chain_id = $1`,
    [chainId],
  );

  const row = existing.rows[0];
  const last = BigInt(row?.last_block ?? "0");
  const staleVault = row?.vault_address && row.vault_address.toLowerCase() !== vault.toLowerCase();
  const staleDeploy =
    row?.deployment_block && BigInt(row.deployment_block) !== deploymentBlock;
  const cursorPastHead = last > chainHead;
  const forceRebuild = Boolean(opts?.forceRebuild);

  if (!row || staleVault || staleDeploy || cursorPastHead || forceRebuild) {
    if (row && (staleVault || staleDeploy || cursorPastHead || forceRebuild)) {
      await query(
        `insert into chain_reorgs (chain_id, from_block, detail)
         values ($1, $2, $3::jsonb)`,
        [
          chainId,
          last.toString(),
          JSON.stringify({
            reason: forceRebuild
              ? "rebuild_requested"
              : staleVault
                ? "vault_redeployed"
                : staleDeploy
                  ? "deployment_block_changed"
                  : "cursor_past_head",
            previousVault: row.vault_address,
            nextVault: vault,
            previousCursor: last.toString(),
            chainHead: chainHead.toString(),
            deploymentBlock: deploymentBlock.toString(),
          }),
        ],
      );
      if (forceRebuild) metrics.noteRebuild();
      console.warn(
        `[indexer] resetting cursor chain=${chainId} from ${last} → ${deploymentBlock} (${
          forceRebuild
            ? "rebuild"
            : staleVault
              ? "vault change"
              : cursorPastHead
                ? "past head"
                : "deploy change"
        })`,
      );
    }
    await query(
      `insert into chain_cursors (chain_id, last_block, last_log_index, vault_address, deployment_block, updated_at)
       values ($1, $2, 0, $3, $4, now())
       on conflict (chain_id) do update
         set last_block = excluded.last_block,
             last_log_index = 0,
             vault_address = excluded.vault_address,
             deployment_block = excluded.deployment_block,
             updated_at = now()`,
      [chainId, deploymentBlock.toString(), vault.toLowerCase(), deploymentBlock.toString()],
    );
    return deploymentBlock;
  }

  await query(
    `update chain_cursors
     set vault_address = $2, deployment_block = $3, updated_at = now()
     where chain_id = $1`,
    [chainId, vault.toLowerCase(), deploymentBlock.toString()],
  );
  return last > 0n ? last : deploymentBlock;
}

export async function setCursor(chainId: number, block: bigint, logIndex: number) {
  await query(
    `update chain_cursors
     set last_block = $2, last_log_index = $3, updated_at = now()
     where chain_id = $1`,
    [chainId, block.toString(), logIndex],
  );
}

/** Explicit rebuild: reset cursor to deployment block; event upserts remain idempotent. */
export async function requestRebuild(
  chainId: number,
  vault: Hex,
  deploymentBlock: bigint,
  chainHead: bigint,
): Promise<bigint> {
  return ensureCursor(chainId, vault, deploymentBlock, chainHead, { forceRebuild: true });
}

export async function getCursorBlock(chainId: number): Promise<bigint | null> {
  const res = await query<{ last_block: string }>(
    `select last_block::text from chain_cursors where chain_id = $1`,
    [chainId],
  );
  if (!res.rows[0]) return null;
  return BigInt(res.rows[0].last_block);
}
