/**
 * MC-051 — Player restriction overlays (matchmaking / review flags only).
 * Never edits balances, stacks, or settlement outcomes.
 */

import { query, type DbClient } from "./client.js";

export type PlayerRestrictionAction =
  | "restrict_new_matchmaking"
  | "clear_restrict_new_matchmaking"
  | "mark_under_review"
  | "clear_under_review"
  | "require_integrity_review"
  | "clear_integrity_review"
  | "clear_review";

const PLAYER_RESTRICTION_ACTIONS = new Set<PlayerRestrictionAction>([
  "restrict_new_matchmaking",
  "clear_restrict_new_matchmaking",
  "mark_under_review",
  "clear_under_review",
  "require_integrity_review",
  "clear_integrity_review",
  "clear_review",
]);

export function isPlayerRestrictionAction(value: string): value is PlayerRestrictionAction {
  return PLAYER_RESTRICTION_ACTIONS.has(value as PlayerRestrictionAction);
}

export type AdminPlayerOps = {
  profileId: string;
  restrictNewMatchmaking: boolean;
  underReview: boolean;
  requireIntegrityReview: boolean;
  notes: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
};

function db(client?: DbClient) {
  return client ?? { query };
}

function mapOps(row: {
  profile_id: string;
  restrict_new_matchmaking: boolean;
  under_review: boolean;
  require_integrity_review: boolean;
  notes: string | null;
  updated_at: string;
  updated_by: string | null;
}): AdminPlayerOps {
  return {
    profileId: row.profile_id,
    restrictNewMatchmaking: row.restrict_new_matchmaking,
    underReview: row.under_review,
    requireIntegrityReview: row.require_integrity_review,
    notes: row.notes,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

export async function getPlayerOps(
  profileId: string,
  client?: DbClient,
): Promise<AdminPlayerOps | null> {
  const q = db(client);
  try {
    const res = await q.query<{
      profile_id: string;
      restrict_new_matchmaking: boolean;
      under_review: boolean;
      require_integrity_review: boolean;
      notes: string | null;
      updated_at: string;
      updated_by: string | null;
    }>(`select * from admin_player_ops where profile_id = $1::uuid`, [profileId]);
    const row = res.rows[0];
    return row ? mapOps(row) : null;
  } catch {
    return null;
  }
}

export function applyPlayerRestrictionAction(
  current: AdminPlayerOps | null,
  action: PlayerRestrictionAction,
): Pick<AdminPlayerOps, "restrictNewMatchmaking" | "underReview" | "requireIntegrityReview"> {
  const base = {
    restrictNewMatchmaking: current?.restrictNewMatchmaking ?? false,
    underReview: current?.underReview ?? false,
    requireIntegrityReview: current?.requireIntegrityReview ?? false,
  };
  switch (action) {
    case "restrict_new_matchmaking":
      return { ...base, restrictNewMatchmaking: true };
    case "clear_restrict_new_matchmaking":
      return { ...base, restrictNewMatchmaking: false };
    case "mark_under_review":
      return { ...base, underReview: true };
    case "clear_under_review":
      return { ...base, underReview: false };
    case "require_integrity_review":
      return { ...base, requireIntegrityReview: true };
    case "clear_integrity_review":
      return { ...base, requireIntegrityReview: false };
    case "clear_review":
      return {
        restrictNewMatchmaking: false,
        underReview: false,
        requireIntegrityReview: false,
      };
    default: {
      const _exhaustive: never = action;
      throw new Error(`unknown player restriction action: ${_exhaustive}`);
    }
  }
}

export async function mutatePlayerRestrictions(input: {
  profileId: string;
  action: PlayerRestrictionAction;
  reason: string;
  role: string;
  actorLabel?: string | null;
  requestId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<{ ops: AdminPlayerOps; auditId: string }> {
  const reason = input.reason.trim();
  if (!reason) throw new Error("reason_required");

  const exists = await query<{ id: string }>(
    `select id::text from profiles where id = $1::uuid`,
    [input.profileId],
  );
  if (!exists.rows[0]) throw new Error("player_not_found");

  const previous = await getPlayerOps(input.profileId);
  const nextFlags = applyPlayerRestrictionAction(previous, input.action);

  let upsert: { rows: Array<Parameters<typeof mapOps>[0]> };
  try {
    upsert = await query(
      `insert into admin_player_ops (
         profile_id, restrict_new_matchmaking, under_review, require_integrity_review,
         notes, updated_at, updated_by
       ) values ($1::uuid, $2, $3, $4, $5, now(), $6)
       on conflict (profile_id) do update set
         restrict_new_matchmaking = excluded.restrict_new_matchmaking,
         under_review = excluded.under_review,
         require_integrity_review = excluded.require_integrity_review,
         notes = excluded.notes,
         updated_at = now(),
         updated_by = excluded.updated_by
       returning *`,
      [
        input.profileId,
        nextFlags.restrictNewMatchmaking,
        nextFlags.underReview,
        nextFlags.requireIntegrityReview,
        reason,
        input.actorLabel ?? null,
      ],
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("admin_player_ops") && msg.includes("does not exist")) {
      throw new Error("player_ops_unavailable");
    }
    throw err;
  }

  const ops = mapOps(upsert.rows[0]!);

  const { appendAdminAction } = await import("./admin-audit.js");
  const { id: auditId } = await appendAdminAction({
    action: `player_ops.${input.action}`,
    role: input.role,
    actorLabel: input.actorLabel,
    reason,
    entityType: "profile",
    entityId: input.profileId,
    capability: "mutate",
    previousState: previous,
    newState: ops,
    requestId: input.requestId,
    ip: input.ip,
    userAgent: input.userAgent,
  });

  return { ops, auditId };
}
