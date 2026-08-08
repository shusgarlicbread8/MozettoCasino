/**
 * MC-063/065/075 — city matchmaking gates + feature-flag runtime controls.
 */

import { appendAdminAction } from "./admin-audit.js";
import { query, type DbClient } from "./client.js";

export type AdminCityOps = {
  leagueId: string;
  pauseMatchmaking: boolean;
  drain: boolean;
  notes: string | null;
  updatedAt: string;
  updatedBy: string | null;
};

export type CityOpsAction =
  | "pause_matchmaking"
  | "resume_matchmaking"
  | "drain"
  | "clear_drain"
  | "resume";

export type MatchmakingGlobalAction = "pause_global" | "resume_global";

export type AiRuntimeAction =
  | "disable_groq"
  | "enable_groq"
  | "stop_new_ai_sessions"
  | "allow_new_ai_sessions";

function db(client?: DbClient) {
  return client ?? { query };
}

function mapCity(row: {
  league_id: string;
  pause_matchmaking: boolean;
  drain: boolean;
  notes: string | null;
  updated_at: string;
  updated_by: string | null;
}): AdminCityOps {
  return {
    leagueId: row.league_id,
    pauseMatchmaking: row.pause_matchmaking,
    drain: row.drain,
    notes: row.notes,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

export async function getCityOps(leagueId: string, client?: DbClient): Promise<AdminCityOps | null> {
  const q = db(client);
  const res = await q.query<{
    league_id: string;
    pause_matchmaking: boolean;
    drain: boolean;
    notes: string | null;
    updated_at: string;
    updated_by: string | null;
  }>(`select * from admin_city_ops where league_id = $1`, [leagueId]);
  const row = res.rows[0];
  return row ? mapCity(row) : null;
}

export async function listCityOps(client?: DbClient): Promise<AdminCityOps[]> {
  const q = db(client);
  const res = await q.query<{
    league_id: string;
    pause_matchmaking: boolean;
    drain: boolean;
    notes: string | null;
    updated_at: string;
    updated_by: string | null;
  }>(`select * from admin_city_ops order by league_id`);
  return res.rows.map(mapCity);
}

/** True when city blocks new matchmaking (paused or draining). */
export async function isCityMatchmakingBlocked(leagueId: string): Promise<boolean> {
  const ops = await getCityOps(leagueId).catch(() => null);
  if (!ops) return false;
  return ops.pauseMatchmaking || ops.drain;
}

export async function mutateCityOps(input: {
  leagueId: string;
  action: CityOpsAction;
  reason: string;
  role: string;
  actorLabel?: string | null;
  requestId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<{ ops: AdminCityOps; auditId: string }> {
  const reason = input.reason.trim();
  if (!reason) throw new Error("reason_required");
  const previous = await getCityOps(input.leagueId);
  let pause = previous?.pauseMatchmaking ?? false;
  let drain = previous?.drain ?? false;
  switch (input.action) {
    case "pause_matchmaking":
      pause = true;
      break;
    case "resume_matchmaking":
      pause = false;
      break;
    case "drain":
      drain = true;
      pause = true;
      break;
    case "clear_drain":
      drain = false;
      break;
    case "resume":
      pause = false;
      drain = false;
      break;
    default:
      throw new Error("invalid_city_action");
  }

  const upsert = await query<{
    league_id: string;
    pause_matchmaking: boolean;
    drain: boolean;
    notes: string | null;
    updated_at: string;
    updated_by: string | null;
  }>(
    `insert into admin_city_ops (league_id, pause_matchmaking, drain, notes, updated_at, updated_by)
     values ($1, $2, $3, $4, now(), $5)
     on conflict (league_id) do update set
       pause_matchmaking = excluded.pause_matchmaking,
       drain = excluded.drain,
       notes = excluded.notes,
       updated_at = now(),
       updated_by = excluded.updated_by
     returning *`,
    [input.leagueId, pause, drain, reason, input.actorLabel ?? null],
  );
  const ops = mapCity(upsert.rows[0]!);
  const { id: auditId } = await appendAdminAction({
    action: `city_ops.${input.action}`,
    role: input.role,
    actorLabel: input.actorLabel,
    reason,
    entityType: "city",
    entityId: input.leagueId,
    capability: "matchmaking.pause",
    previousState: previous,
    newState: ops,
    requestId: input.requestId,
    ip: input.ip,
    userAgent: input.userAgent,
  });
  return { ops, auditId };
}

export async function setFeatureFlag(input: {
  key: string;
  enabled: boolean;
  reason: string;
  role: string;
  actorLabel?: string | null;
  meta?: Record<string, unknown>;
  requestId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<{ key: string; enabled: boolean; auditId: string }> {
  const reason = input.reason.trim();
  if (!reason) throw new Error("reason_required");
  const prev = await query<{ enabled: boolean; meta: unknown }>(
    `select enabled, meta from feature_flags where key = $1`,
    [input.key],
  );
  await query(
    `insert into feature_flags (key, enabled, meta, updated_at)
     values ($1, $2, coalesce($3::jsonb, '{}'::jsonb), now())
     on conflict (key) do update set
       enabled = excluded.enabled,
       meta = feature_flags.meta || excluded.meta,
       updated_at = now()`,
    [input.key, input.enabled, JSON.stringify(input.meta ?? { reason })],
  );
  const { id: auditId } = await appendAdminAction({
    action: `feature_flag.${input.key}.${input.enabled ? "enable" : "disable"}`,
    role: input.role,
    actorLabel: input.actorLabel,
    reason,
    entityType: "feature_flag",
    entityId: input.key,
    capability: "mutate",
    previousState: prev.rows[0] ?? null,
    newState: { key: input.key, enabled: input.enabled },
    requestId: input.requestId,
    ip: input.ip,
    userAgent: input.userAgent,
  });
  return { key: input.key, enabled: input.enabled, auditId };
}

export async function mutateMatchmakingGlobal(input: {
  action: MatchmakingGlobalAction;
  reason: string;
  role: string;
  actorLabel?: string | null;
  requestId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<{ enabled: boolean; auditId: string }> {
  const enabled = input.action === "resume_global";
  const res = await setFeatureFlag({
    key: "onchain_matchmaking",
    enabled,
    reason: input.reason,
    role: input.role,
    actorLabel: input.actorLabel,
    meta: { source: "control_matchmaking_ops", action: input.action },
    requestId: input.requestId,
    ip: input.ip,
    userAgent: input.userAgent,
  });
  return { enabled: res.enabled, auditId: res.auditId };
}

export async function mutateAiRuntime(input: {
  action: AiRuntimeAction;
  reason: string;
  role: string;
  actorLabel?: string | null;
  requestId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<{ key: string; enabled: boolean; auditId: string }> {
  let key: string;
  let enabled: boolean;
  switch (input.action) {
    case "disable_groq":
      key = "ai_provider_groq";
      enabled = false;
      break;
    case "enable_groq":
      key = "ai_provider_groq";
      enabled = true;
      break;
    case "stop_new_ai_sessions":
      key = "ai_new_sessions";
      enabled = false;
      break;
    case "allow_new_ai_sessions":
      key = "ai_new_sessions";
      enabled = true;
      break;
    default:
      throw new Error("invalid_ai_action");
  }
  return setFeatureFlag({
    key,
    enabled,
    reason: input.reason,
    role: input.role,
    actorLabel: input.actorLabel,
    meta: { source: "control_ai_ops", action: input.action },
    requestId: input.requestId,
    ip: input.ip,
    userAgent: input.userAgent,
  });
}

/** Player-level restriction gate for find-match. */
export async function isProfileMatchmakingRestricted(profileId: string): Promise<boolean> {
  const res = await query<{ restrict_new_matchmaking: boolean }>(
    `select restrict_new_matchmaking from admin_player_ops where profile_id = $1`,
    [profileId],
  ).catch(() => ({ rows: [] as { restrict_new_matchmaking: boolean }[] }));
  return Boolean(res.rows[0]?.restrict_new_matchmaking);
}
