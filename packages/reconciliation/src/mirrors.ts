import { query } from "@mozetto/database";
import type { MirrorBalances } from "./types.js";

export type MirrorReader = {
  readOpenSessionLockedRaw: (chainId: number) => Promise<bigint>;
  readLedgerMirrors: () => Promise<{ availableUsdc: number; escrowUsdc: number }>;
};

/** Postgres mirrors produced by the chain indexer / session projections. */
export function createDbMirrorReader(): MirrorReader {
  return {
    async readOpenSessionLockedRaw(chainId) {
      const res = await query<{ s: string }>(
        `select coalesce(sum(p.buy_in_raw), 0)::text as s
         from onchain_session_players p
         join onchain_sessions s on s.session_id = p.session_id
         where s.chain_id = $1
           and s.status in ('pending', 'opened', 'playing', 'settling')`,
        [chainId],
      );
      return BigInt(res.rows[0]?.s ?? "0");
    },
    async readLedgerMirrors() {
      const res = await query<{ available: string; escrow: string }>(
        `select
           coalesce(sum(case when a.kind = 'user_available' then e.amount else 0 end), 0)::text as available,
           coalesce(sum(case when a.kind = 'user_table_escrow' then e.amount else 0 end), 0)::text as escrow
         from ledger_accounts a
         left join ledger_entries e on e.account_id = a.id
         where a.arena_mode = 'onchain'
           and a.kind in ('user_available', 'user_table_escrow')`,
      );
      return {
        availableUsdc: Number(res.rows[0]?.available ?? 0),
        escrowUsdc: Number(res.rows[0]?.escrow ?? 0),
      };
    },
  };
}

export async function fetchMirrorBalances(
  reader: MirrorReader,
  chainId: number,
): Promise<MirrorBalances> {
  const [openSessionLockedRaw, ledger] = await Promise.all([
    reader.readOpenSessionLockedRaw(chainId),
    reader.readLedgerMirrors(),
  ]);
  return {
    openSessionLockedRaw,
    mirrorAvailableUsdc: ledger.availableUsdc,
    mirrorEscrowUsdc: ledger.escrowUsdc,
  };
}
