import { query, settleRatedMatch } from "@mozetto/database";
import type { Hex } from "viem";
import { keccakLike } from "./chain.js";

/**
 * Post-settlement Glicko for on-chain HU sessions.
 * `eventLogRoot` should be the FinalSettlementV3 EIP-712 digest when settling via Hub V3.
 */
export async function maybeRateOnchainSession(
  sessionId: string,
  _balances: Record<string, number>,
  eventLogRoot?: Hex | string,
) {
  const meta = await query<{ table_id: string; variant_id: string; max_seats: number }>(
    `select os.table_id, t.variant_id::text as variant_id, t.max_seats::int as max_seats
     from onchain_sessions os
     join tables t on t.id = os.table_id
     where os.session_id = $1 limit 1`,
    [sessionId],
  );
  const tableId = meta.rows[0]?.table_id ?? null;
  const variantId = meta.rows[0]?.variant_id ?? "";
  const maxSeats = Number(meta.rows[0]?.max_seats ?? 0);

  const rows = await query<{ owner_id: string; agent_id: string; buy_in: string; stack: string }>(
    `select distinct on (owner_id)
            owner_id::text, coalesce(agent_id::text, '') as agent_id, buy_in::text, stack::text
     from table_sessions
     where table_id = $2
       and owner_id in (
         select profile_id from onchain_session_players where session_id = $1
       )
     order by owner_id, coalesce(ended_at, started_at) desc`,
    [sessionId, tableId],
  );
  // Only HU-style rating (exactly two owners). Multiway Classic stays unrated for now.
  if (rows.rows.length !== 2 || !tableId) return;
  const poolId =
    variantId === "nlhe_hu" || maxSeats === 2
      ? "hu_holdem_standard"
      : variantId === "nlhe_6max"
        ? "nlhe_6max_standard"
        : null;
  if (!poolId) return;
  const [a, b] = rows.rows;

  const handsRow = await query<{ n: string }>(
    `select count(*)::text as n from hands
     where table_id = $1 and (status = 'settled' or settled_at is not null)`,
    [tableId],
  );
  const maxHand = await query<{ m: string }>(
    `select coalesce(max(hand_number), 0)::text as m from hands where table_id = $1`,
    [tableId],
  );
  const hands = Math.max(
    Number(handsRow.rows[0]?.n ?? 0),
    Number(maxHand.rows[0]?.m ?? 0),
    1,
  );

  const profitA = Number(a.stack) - Number(a.buy_in);
  const profitB = Number(b.stack) - Number(b.buy_in);
  const scoreA: 0 | 0.5 | 1 = profitA > profitB ? 1 : profitA < profitB ? 0 : 0.5;
  // Six-max Season 1 is unrated (Plan 12) — gate skips nlhe_6max_* pools.
  await settleRatedMatch({
    poolId,
    ownerA: a.owner_id,
    ownerB: b.owner_id,
    agentA: a.agent_id || null,
    agentB: b.agent_id || null,
    scoreA,
    hands,
    tableId,
    stake: Number(a.buy_in),
    eventLogRoot: eventLogRoot ?? keccakLike(`onchain:${sessionId}`),
    reason: eventLogRoot ? "onchain_settled_v3" : "onchain_settled",
    gate: {
      matchClass: "ranked_public",
      settlementConfirmed: true,
      replayOrEventVerified: true,
      sessionId,
      allowMissingProofRoot: false,
    },
  });
}
