/**
 * WP-042 — DB helpers for table epochs + queued seat changes.
 * Failures against older DBs (pre-migration 018) are non-fatal where noted.
 */

import { randomUUID } from "node:crypto";
import { query } from "./client.js";
import {
  handPhase,
  participantSnapshot,
  planEpochBoundary,
  targetEpochForQueue,
  validateEnqueue,
  type EpochParticipant,
  type HandPhase,
  type QueuedSeatChange,
  type SeatChangeType,
} from "./epoch-rotation.js";

export type TableEpochRow = {
  id: string;
  table_id: string;
  epoch_number: number;
  status: string;
  hand_number_start: number | null;
  hand_number_end: number | null;
  participant_snapshot: unknown;
  opened_at: string;
  closed_at: string | null;
};

function mapChange(row: Record<string, unknown>): QueuedSeatChange {
  return {
    id: String(row.id),
    tableId: String(row.table_id),
    targetEpoch: Number(row.target_epoch),
    changeType: row.change_type as SeatChangeType,
    status: row.status as QueuedSeatChange["status"],
    ownerId: String(row.owner_id),
    agentId: row.agent_id != null ? String(row.agent_id) : null,
    agentConfigId: row.agent_config_id != null ? String(row.agent_config_id) : null,
    seatIndex: row.seat_index != null ? Number(row.seat_index) : null,
    amount: row.amount != null ? Number(row.amount) : null,
    profileKey: row.profile_key != null ? String(row.profile_key) : null,
    payload: (row.payload as Record<string, unknown>) ?? {},
    requestedAt: row.requested_at != null ? String(row.requested_at) : undefined,
  };
}

/** Ensure an open epoch exists for the table; create epoch 1 if none. */
export async function ensureOpenEpoch(
  tableId: string,
  participants: EpochParticipant[] = [],
): Promise<TableEpochRow> {
  const existing = await query<TableEpochRow>(
    `select * from table_epochs
     where table_id = $1 and status in ('open', 'active')
     order by epoch_number desc limit 1`,
    [tableId],
  ).catch(() => ({ rows: [] as TableEpochRow[] }));

  if (existing.rows[0]) return existing.rows[0];

  const inserted = await query<TableEpochRow>(
    `insert into table_epochs (table_id, epoch_number, status, participant_snapshot)
     values ($1, 1, 'open', $2::jsonb)
     on conflict (table_id, epoch_number) do update
       set status = excluded.status
     returning *`,
    [tableId, JSON.stringify(participantSnapshot(participants))],
  );
  return inserted.rows[0]!;
}

export async function getOpenEpoch(tableId: string): Promise<TableEpochRow | null> {
  const r = await query<TableEpochRow>(
    `select * from table_epochs
     where table_id = $1 and status in ('open', 'active')
     order by epoch_number desc limit 1`,
    [tableId],
  ).catch(() => ({ rows: [] as TableEpochRow[] }));
  return r.rows[0] ?? null;
}

export async function markEpochActive(tableId: string, handNumber: number): Promise<void> {
  await query(
    `update table_epochs
     set status = 'active',
         hand_number_start = coalesce(hand_number_start, $2)
     where table_id = $1 and status in ('open', 'active')`,
    [tableId, handNumber],
  ).catch((err) => console.warn("[epoch] markEpochActive skipped", tableId, err));
}

export async function listPendingSeatChanges(tableId: string): Promise<QueuedSeatChange[]> {
  const r = await query(
    `select * from queued_seat_changes
     where table_id = $1 and status = 'pending'
     order by requested_at asc`,
    [tableId],
  ).catch(() => ({ rows: [] as Record<string, unknown>[] }));
  return r.rows.map(mapChange);
}

export async function listPendingLeaveOwnerIds(tableId: string): Promise<Set<string>> {
  const pending = await listPendingSeatChanges(tableId);
  return new Set(pending.filter((c) => c.changeType === "leave").map((c) => c.ownerId));
}

/** Cancel a pending leave so the owner stays for the next hand. */
export async function cancelPendingLeave(tableId: string, ownerId: string): Promise<{
  cancelled: boolean;
  reason?: string;
}> {
  const r = await query<{ id: string }>(
    `update queued_seat_changes
     set status = 'cancelled', applied_at = now(), reject_reason = 'cancelled_by_owner'
     where table_id = $1 and owner_id = $2 and change_type = 'leave' and status = 'pending'
     returning id`,
    [tableId, ownerId],
  ).catch(() => ({ rows: [] as { id: string }[] }));
  if (!r.rows.length) return { cancelled: false, reason: "no_pending_leave" };
  return { cancelled: true };
}

export type EnqueueSeatChangeInput = {
  tableId: string;
  changeType: SeatChangeType;
  ownerId: string;
  phase: HandPhase;
  participants: EpochParticipant[];
  agentId?: string | null;
  agentConfigId?: string | null;
  seatIndex?: number | null;
  amount?: number | null;
  profileKey?: string | null;
  payload?: Record<string, unknown>;
  idempotencyKey?: string;
};

export type EnqueueSeatChangeResult =
  | { queued: true; change: QueuedSeatChange; targetEpoch: number }
  | { queued: false; reason: string };

export async function enqueueSeatChange(
  input: EnqueueSeatChangeInput,
): Promise<EnqueueSeatChangeResult> {
  const pending = await listPendingSeatChanges(input.tableId);
  const validation = validateEnqueue({
    changeType: input.changeType,
    ownerId: input.ownerId,
    phase: input.phase,
    participants: input.participants,
    pending,
    amount: input.amount,
  });
  if (validation.ok === false) return { queued: false, reason: validation.reason };

  const epoch = await ensureOpenEpoch(input.tableId, input.participants);
  const targetEpoch = targetEpochForQueue(Number(epoch.epoch_number), input.phase);
  const id = randomUUID();
  const idem =
    input.idempotencyKey ??
    `${input.changeType}:${input.tableId}:${input.ownerId}:${targetEpoch}:${input.phase}`;

  try {
    const inserted = await query(
      `insert into queued_seat_changes (
         id, table_id, target_epoch, change_type, status,
         owner_id, agent_id, agent_config_id, seat_index, amount,
         profile_key, payload, idempotency_key
       ) values ($1,$2,$3,$4,'pending',$5,$6,$7,$8,$9,$10,$11::jsonb,$12)
       on conflict (table_id, idempotency_key) do update
         set payload = excluded.payload
       returning *`,
      [
        id,
        input.tableId,
        targetEpoch,
        input.changeType,
        input.ownerId,
        input.agentId ?? null,
        input.agentConfigId ?? null,
        input.seatIndex ?? null,
        input.amount ?? null,
        input.profileKey ?? null,
        JSON.stringify(input.payload ?? {}),
        idem,
      ],
    );
    const change = mapChange(inserted.rows[0]!);
    return { queued: true, change, targetEpoch };
  } catch (err) {
    console.error("[epoch] enqueueSeatChange failed", input.tableId, err);
    return { queued: false, reason: "enqueue_failed" };
  }
}

export async function markSeatChangesApplied(ids: string[]): Promise<void> {
  if (!ids.length) return;
  await query(
    `update queued_seat_changes
     set status = 'applied', applied_at = now()
     where id = any($1::uuid[])`,
    [ids],
  ).catch((err) => console.warn("[epoch] markSeatChangesApplied skipped", err));
}

export async function markSeatChangesRejected(
  rejected: { id: string; reason: string }[],
): Promise<void> {
  for (const r of rejected) {
    await query(
      `update queued_seat_changes
       set status = 'rejected', reject_reason = $2, applied_at = now()
       where id = $1`,
      [r.id, r.reason],
    ).catch(() => null);
  }
}

/**
 * Close the current epoch and open the next with the planned participant snapshot.
 * Returns the boundary plan (caller applies seat mutations in game-server).
 */
export async function rotateEpochAtBoundary(opts: {
  tableId: string;
  participants: EpochParticipant[];
  maxSeats: number;
  handNumberEnd?: number | null;
}): Promise<{
  plan: ReturnType<typeof planEpochBoundary>;
  nextEpochRow: TableEpochRow;
} | null> {
  try {
    const current = await ensureOpenEpoch(opts.tableId, opts.participants);
    const pending = await listPendingSeatChanges(opts.tableId);
    const plan = planEpochBoundary({
      currentEpoch: Number(current.epoch_number),
      participants: opts.participants,
      pending,
      maxSeats: opts.maxSeats,
    });

    await query(
      `update table_epochs
       set status = 'closed',
           closed_at = now(),
           hand_number_end = coalesce($3, hand_number_end)
       where id = $1 and table_id = $2`,
      [current.id, opts.tableId, opts.handNumberEnd ?? null],
    );

    const next = await query<TableEpochRow>(
      `insert into table_epochs (table_id, epoch_number, status, participant_snapshot)
       values ($1, $2, 'open', $3::jsonb)
       on conflict (table_id, epoch_number) do update
         set status = 'open',
             participant_snapshot = excluded.participant_snapshot,
             closed_at = null
       returning *`,
      [opts.tableId, plan.nextEpoch, JSON.stringify(participantSnapshot(plan.nextParticipants))],
    );

    await markSeatChangesApplied(plan.appliedIds);
    await markSeatChangesRejected(plan.rejected);

    return { plan, nextEpochRow: next.rows[0]! };
  } catch (err) {
    console.error("[epoch] rotateEpochAtBoundary failed", opts.tableId, err);
    return null;
  }
}

export { handPhase, planEpochBoundary, validateEnqueue, targetEpochForQueue };
