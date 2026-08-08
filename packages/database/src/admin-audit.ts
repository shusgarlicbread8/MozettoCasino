/**
 * WP-094 — append-only admin audit writes + session ops overlays.
 * Privileged mutations go through these helpers so every change is logged.
 */

import { query, type DbClient } from "./client.js";

export type AdminRoleName = "viewer" | "operator" | "risk" | "admin";

export type AdminSessionOps = {
  sessionId: string;
  pauseAfterHand: boolean;
  underReview: boolean;
  replayRequested: boolean;
  /** Refuse new joins; current hand still completes (table drain). */
  disableNewSeats: boolean;
  notes: string | null;
  updatedAt: string;
  updatedBy: string | null;
};

export type AppendAdminActionInput = {
  action: string;
  role: AdminRoleName | string;
  actorLabel?: string | null;
  adminId?: string | null;
  reason?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  capability?: "read" | "mutate" | string | null;
  previousState?: unknown;
  newState?: unknown;
  requestId?: string | null;
  safeTxId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
};

export type SessionOpsAction =
  | "pause_after_hand"
  | "clear_pause_after_hand"
  | "mark_under_review"
  | "clear_under_review"
  | "request_replay"
  | "clear_replay"
  | "drain_table"
  | "clear_drain_table"
  | "resume";

const SESSION_OPS_ACTIONS = new Set<SessionOpsAction>([
  "pause_after_hand",
  "clear_pause_after_hand",
  "mark_under_review",
  "clear_under_review",
  "request_replay",
  "clear_replay",
  "drain_table",
  "clear_drain_table",
  "resume",
]);

export function isSessionOpsAction(value: string): value is SessionOpsAction {
  return SESSION_OPS_ACTIONS.has(value as SessionOpsAction);
}

function db(client?: DbClient) {
  return client ?? { query };
}

/** Insert one append-only admin_actions row. Never updates/deletes. */
export async function appendAdminAction(
  input: AppendAdminActionInput,
  client?: DbClient,
): Promise<{ id: string }> {
  const q = db(client);
  const res = await q.query<{ id: string }>(
    `insert into admin_actions (
       admin_id, role, action, reason, previous_state, new_state,
       request_id, safe_tx_id, actor_label, entity_type, entity_id,
       capability, ip, user_agent
     ) values (
       $1, $2, $3, $4, $5::jsonb, $6::jsonb,
       $7, $8, $9, $10, $11,
       $12, $13, $14
     ) returning id::text`,
    [
      input.adminId ?? null,
      input.role,
      input.action,
      input.reason ?? null,
      JSON.stringify(input.previousState ?? null),
      JSON.stringify(input.newState ?? null),
      input.requestId ?? null,
      input.safeTxId ?? null,
      input.actorLabel ?? null,
      input.entityType ?? null,
      input.entityId ?? null,
      input.capability ?? null,
      input.ip ?? null,
      input.userAgent ?? null,
    ],
  );
  const id = res.rows[0]?.id;
  if (!id) throw new Error("admin_actions insert returned no id");
  return { id };
}

export async function listAdminActions(
  opts?: { limit?: number; entityType?: string; entityId?: string },
  client?: DbClient,
): Promise<
  Array<{
    id: string;
    role: string | null;
    action: string;
    reason: string | null;
    actorLabel: string | null;
    entityType: string | null;
    entityId: string | null;
    capability: string | null;
    previousState: unknown;
    newState: unknown;
    requestId: string | null;
    safeTxId: string | null;
    createdAt: string;
  }>
> {
  const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 200);
  const q = db(client);
  const res = await q.query<{
    id: string;
    role: string | null;
    action: string;
    reason: string | null;
    actor_label: string | null;
    entity_type: string | null;
    entity_id: string | null;
    capability: string | null;
    previous_state: unknown;
    new_state: unknown;
    request_id: string | null;
    safe_tx_id: string | null;
    created_at: string;
  }>(
    `select id::text, role, action, reason, actor_label, entity_type, entity_id,
            capability, previous_state, new_state, request_id, safe_tx_id, created_at
     from admin_actions
     where ($2::text is null or entity_type = $2)
       and ($3::text is null or entity_id = $3)
     order by created_at desc
     limit $1`,
    [limit, opts?.entityType ?? null, opts?.entityId ?? null],
  );
  return res.rows.map((r) => ({
    id: r.id,
    role: r.role,
    action: r.action,
    reason: r.reason,
    actorLabel: r.actor_label,
    entityType: r.entity_type,
    entityId: r.entity_id,
    capability: r.capability,
    previousState: r.previous_state,
    newState: r.new_state,
    requestId: r.request_id,
    safeTxId: r.safe_tx_id,
    createdAt: r.created_at,
  }));
}

function mapOps(row: {
  session_id: string;
  pause_after_hand: boolean;
  under_review: boolean;
  replay_requested: boolean;
  disable_new_seats?: boolean | null;
  notes: string | null;
  updated_at: string;
  updated_by: string | null;
}): AdminSessionOps {
  return {
    sessionId: row.session_id,
    pauseAfterHand: row.pause_after_hand,
    underReview: row.under_review,
    replayRequested: row.replay_requested,
    disableNewSeats: Boolean(row.disable_new_seats),
    notes: row.notes,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

export async function getSessionOps(
  sessionId: string,
  client?: DbClient,
): Promise<AdminSessionOps | null> {
  const q = db(client);
  const res = await q.query<{
    session_id: string;
    pause_after_hand: boolean;
    under_review: boolean;
    replay_requested: boolean;
    disable_new_seats: boolean | null;
    notes: string | null;
    updated_at: string;
    updated_by: string | null;
  }>(
    `select session_id, pause_after_hand, under_review, replay_requested,
            coalesce(disable_new_seats, false) as disable_new_seats,
            notes, updated_at, updated_by
     from admin_session_ops where session_id = $1`,
    [sessionId],
  );
  const row = res.rows[0];
  return row ? mapOps(row) : null;
}

export function applySessionOpsAction(
  current: AdminSessionOps | null,
  action: SessionOpsAction,
): Pick<AdminSessionOps, "pauseAfterHand" | "underReview" | "replayRequested" | "disableNewSeats"> {
  const base = {
    pauseAfterHand: current?.pauseAfterHand ?? false,
    underReview: current?.underReview ?? false,
    replayRequested: current?.replayRequested ?? false,
    disableNewSeats: current?.disableNewSeats ?? false,
  };
  switch (action) {
    case "pause_after_hand":
      return { ...base, pauseAfterHand: true };
    case "clear_pause_after_hand":
      return { ...base, pauseAfterHand: false };
    case "mark_under_review":
      return { ...base, underReview: true };
    case "clear_under_review":
      return { ...base, underReview: false };
    case "request_replay":
      return { ...base, replayRequested: true };
    case "clear_replay":
      return { ...base, replayRequested: false };
    case "drain_table":
      return { ...base, pauseAfterHand: true, disableNewSeats: true };
    case "clear_drain_table":
      return { ...base, disableNewSeats: false };
    case "resume":
      return { ...base, pauseAfterHand: false, disableNewSeats: false };
    default: {
      const _exhaustive: never = action;
      throw new Error(`unknown session ops action: ${_exhaustive}`);
    }
  }
}

/** MC-064 — refuse resume while under review or open critical auto-incident for the session. */
export async function assertSessionResumeSafe(sessionId: string): Promise<void> {
  const ops = await getSessionOps(sessionId);
  if (ops?.underReview) {
    throw new Error("resume_blocked_under_review");
  }
  const incidents = await query<{ id: string }>(
    `select id::text from security_incidents
     where status in ('open','acknowledged','investigating')
       and lower(coalesce(severity, '')) in ('critical','high','sev1','sev2')
       and (
         coalesce(auto_source_key, '') like '%' || $1 || '%'
         or coalesce(detail::text, '') like '%' || $1 || '%'
         or coalesce(summary, '') like '%' || $1 || '%'
         or coalesce(title, '') like '%' || $1 || '%'
       )
     limit 1`,
    [sessionId],
  ).catch(() => ({ rows: [] as { id: string }[] }));
  if (incidents.rows[0]) {
    throw new Error("resume_blocked_open_incident");
  }
}

/**
 * Apply a narrow session ops mutation and append an audit row.
 * Does not edit stacks, balances, or onchain session status.
 */
export async function mutateSessionOps(input: {
  sessionId: string;
  action: SessionOpsAction;
  reason: string;
  role: AdminRoleName | string;
  actorLabel?: string | null;
  requestId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<{ ops: AdminSessionOps; auditId: string }> {
  const reason = input.reason.trim();
  if (!reason) throw new Error("reason_required");

  const exists = await query<{ session_id: string }>(
    `select session_id from onchain_sessions where session_id = $1`,
    [input.sessionId],
  );
  if (!exists.rows[0]) throw new Error("session_not_found");

  if (
    input.action === "resume" ||
    input.action === "clear_pause_after_hand" ||
    input.action === "clear_drain_table"
  ) {
    await assertSessionResumeSafe(input.sessionId);
  }

  const previous = await getSessionOps(input.sessionId);
  const nextFlags = applySessionOpsAction(previous, input.action);

  const upsert = await query<{
    session_id: string;
    pause_after_hand: boolean;
    under_review: boolean;
    replay_requested: boolean;
    disable_new_seats: boolean | null;
    notes: string | null;
    updated_at: string;
    updated_by: string | null;
  }>(
    `insert into admin_session_ops (
       session_id, pause_after_hand, under_review, replay_requested, disable_new_seats,
       notes, updated_at, updated_by
     ) values ($1, $2, $3, $4, $5, $6, now(), $7)
     on conflict (session_id) do update set
       pause_after_hand = excluded.pause_after_hand,
       under_review = excluded.under_review,
       replay_requested = excluded.replay_requested,
       disable_new_seats = excluded.disable_new_seats,
       notes = excluded.notes,
       updated_at = now(),
       updated_by = excluded.updated_by
     returning session_id, pause_after_hand, under_review, replay_requested,
               coalesce(disable_new_seats, false) as disable_new_seats,
               notes, updated_at, updated_by`,
    [
      input.sessionId,
      nextFlags.pauseAfterHand,
      nextFlags.underReview,
      nextFlags.replayRequested,
      nextFlags.disableNewSeats,
      reason,
      input.actorLabel ?? null,
    ],
  );

  const ops = mapOps(upsert.rows[0]!);
  const { id: auditId } = await appendAdminAction({
    action: `session_ops.${input.action}`,
    role: input.role,
    actorLabel: input.actorLabel,
    reason,
    entityType: "onchain_session",
    entityId: input.sessionId,
    capability: "mutate",
    previousState: previous,
    newState: ops,
    requestId: input.requestId,
    ip: input.ip,
    userAgent: input.userAgent,
  });

  return { ops, auditId };
}
