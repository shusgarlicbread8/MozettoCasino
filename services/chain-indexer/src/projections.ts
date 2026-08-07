/**
 * Projection-only handlers for vault session events + V3 additive contracts.
 * These MUST NOT credit/debit ledger balances (sole-writer = money.ts).
 */
import { query } from "@mozetto/database";
import type { Hex, Log } from "viem";

const LIFECYCLE_STATUS: Record<number, string> = {
  0: "none",
  1: "draft",
  2: "sealed",
  3: "randomness_pending",
  4: "ready",
  5: "active",
  6: "settling",
  7: "settled",
  8: "aborted",
  9: "emergency_exit",
};

export async function handleSessionOpened(
  chainId: number,
  log: Log & { args: { sessionId?: Hex; templateId?: Hex; playerCount?: bigint } },
) {
  const sessionId = log.args.sessionId;
  if (!sessionId || !log.transactionHash || log.removed) return;
  await query(
    `insert into onchain_sessions
       (session_id, chain_id, game_template_id, open_tx_hash, open_block, status, opened_at)
     values ($1,$2,$3,$4,$5,'opened', now())
     on conflict (session_id) do update
       set status = 'opened',
           open_tx_hash = excluded.open_tx_hash,
           open_block = excluded.open_block,
           opened_at = now()`,
    [
      sessionId,
      chainId,
      log.args.templateId ?? "",
      log.transactionHash,
      (log.blockNumber ?? 0n).toString(),
    ],
  );
  await query(
    `update matchmaking_batches set status = 'opened', opened_at = now(), open_tx_hash = $2
     where session_id = $1`,
    [sessionId, log.transactionHash],
  );
  await query(`update seat_tickets set status = 'opened' where session_id = $1`, [sessionId]);
  console.log(`[indexer] SessionOpened ${sessionId}`);
}

export async function handleSessionSettled(
  _chainId: number,
  log: Log & { args: { sessionId?: Hex } },
) {
  const sessionId = log.args.sessionId;
  if (!sessionId || !log.transactionHash || log.removed) return;
  await query(
    `update onchain_sessions
     set status = 'settled', settlement_tx_hash = $2, settled_at = now()
     where session_id = $1`,
    [sessionId, log.transactionHash],
  );
  await query(`update onchain_seat_locks set status = 'settled' where session_id = $1`, [
    sessionId,
  ]);
}

export async function handleSessionSealed(
  _chainId: number,
  log: Log & { args: { sessionId?: Hex } },
) {
  const sessionId = log.args.sessionId;
  if (!sessionId || !log.transactionHash || log.removed) return;
  await query(
    `update onchain_sessions set status = 'playing' where session_id = $1 and status = 'opened'`,
    [sessionId],
  );
}

export async function handleHubSettled(
  _chainId: number,
  log: Log & { args: { sessionId?: Hex } },
) {
  const sessionId = log.args.sessionId;
  if (!sessionId || !log.transactionHash || log.removed) return;
  await query(
    `update onchain_sessions
     set status = 'settled', settlement_tx_hash = coalesce(settlement_tx_hash, $2), settled_at = coalesce(settled_at, now())
     where session_id = $1`,
    [sessionId, log.transactionHash],
  );
}

export async function handleSessionTransition(
  _chainId: number,
  log: Log & { args: { sessionId?: Hex; to?: number | bigint } },
) {
  const sessionId = log.args.sessionId;
  if (!sessionId || log.removed) return;
  const to = Number(log.args.to ?? -1);
  const label = LIFECYCLE_STATUS[to];
  if (!label) return;
  // Map lifecycle → onchain_sessions status vocabulary where it fits.
  const status =
    label === "settled"
      ? "settled"
      : label === "settling"
        ? "settling"
        : label === "emergency_exit"
          ? "emergency"
          : label === "aborted"
            ? "blocked"
            : label === "active" || label === "ready" || label === "sealed"
              ? "playing"
              : label === "draft"
                ? "pending"
                : null;
  if (!status) return;
  await query(`update onchain_sessions set status = $2 where session_id = $1`, [
    sessionId,
    status,
  ]);
}

/**
 * Dispatch projection handlers by event name.
 * Money events are handled separately in money.ts.
 */
export async function dispatchProjection(
  chainId: number,
  eventName: string,
  log: Log & { args?: Record<string, unknown> },
) {
  switch (eventName) {
    case "SessionOpened":
      await handleSessionOpened(chainId, log as never);
      break;
    case "SessionSettled":
      await handleSessionSettled(chainId, log as never);
      break;
    case "SessionSealed":
      await handleSessionSealed(chainId, log as never);
      break;
    case "Settled":
      await handleHubSettled(chainId, log as never);
      break;
    case "SessionTransition":
      await handleSessionTransition(chainId, log as never);
      break;
    default:
      // Persisted to chain_events only (TemplateActivated, ProofBatchRegistered, VRF, fees, …).
      break;
  }
}
