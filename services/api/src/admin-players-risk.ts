/**
 * MC-050–054 — Player integrity, restrictions, replay, responsible-play, timeline.
 * Never exposes hole cards or raw CoT. UNAVAILABLE when backing tables are missing.
 */

import {
  appendAdminAction,
  getPlayerOps,
  listAdminActions,
  listIdentityClusterEdges,
  MAX_PAIR_MATCHES_PER_DAY,
  mutateSessionOps,
  query,
  type AdminPlayerOps,
} from "@mozetto/database";
import { ADMIN_ECONOMICS_SCHEMA_VERSION } from "./admin-economics-schema.js";

export type ReviewStatus = "SIGNAL" | "REVIEW_REQUIRED" | "RESTRICTED" | "CLEARED";

export type IntegritySignal = {
  kind: string;
  status: ReviewStatus;
  summary: string;
  evidence: Record<string, unknown>;
  source: string;
  available: boolean;
};

export function deriveReviewStatus(input: {
  ops: AdminPlayerOps | null;
  openCollusionCount: number;
  openCaseCount: number;
  signalCount: number;
}): ReviewStatus {
  if (input.ops?.restrictNewMatchmaking) return "RESTRICTED";
  if (
    input.ops?.underReview ||
    input.ops?.requireIntegrityReview ||
    input.openCollusionCount > 0 ||
    input.openCaseCount > 0
  ) {
    return "REVIEW_REQUIRED";
  }
  if (input.signalCount > 0) return "SIGNAL";
  return "CLEARED";
}

async function tableExists(tableName: string): Promise<boolean> {
  try {
    const res = await query<{ reg: string | null }>(
      `select to_regclass($1) as reg`,
      [`public.${tableName}`],
    );
    return Boolean(res.rows[0]?.reg);
  } catch {
    return false;
  }
}

async function profileExists(profileId: string): Promise<boolean> {
  const res = await query<{ id: string }>(
    `select id::text from profiles where id = $1::uuid limit 1`,
    [profileId],
  );
  return Boolean(res.rows[0]);
}

export async function getAdminPlayerIntegrity(profileId: string) {
  if (!(await profileExists(profileId))) return null;

  const [
    ops,
    hasPairHistory,
    hasIdentityEdges,
    hasRatHole,
    hasCollusion,
    hasIntegrityCases,
    hasPlayerOps,
  ] = await Promise.all([
    getPlayerOps(profileId),
    tableExists("rated_matches"),
    tableExists("identity_cluster_edges"),
    tableExists("rat_hole_exits"),
    tableExists("collusion_signals"),
    tableExists("integrity_cases"),
    tableExists("admin_player_ops"),
  ]);

  const signals: IntegritySignal[] = [];

  // Pair caps (MC-050)
  let pairCaps: {
    available: boolean;
    capThreshold: number;
    cappedOpponents: Array<{ opponentId: string; matches24h: number }>;
  } = { available: false, capThreshold: MAX_PAIR_MATCHES_PER_DAY, cappedOpponents: [] };

  if (hasPairHistory) {
    try {
      const capped = await query<{ opponent_id: string; matches_24h: number }>(
        `select
           case when owner_a = $1::uuid then owner_b::text else owner_a::text end as opponent_id,
           count(*)::int as matches_24h
         from rated_matches
         where created_at > now() - interval '24 hours'
           and weight > 0
           and (owner_a = $1::uuid or owner_b = $1::uuid)
         group by 1
         having count(*) >= $2`,
        [profileId, MAX_PAIR_MATCHES_PER_DAY],
      );
      pairCaps = {
        available: true,
        capThreshold: MAX_PAIR_MATCHES_PER_DAY,
        cappedOpponents: capped.rows.map((r) => ({
          opponentId: r.opponent_id,
          matches24h: r.matches_24h,
        })),
      };
      for (const row of capped.rows) {
        signals.push({
          kind: "pair_cap",
          status: "SIGNAL",
          summary: `Daily pair cap (${MAX_PAIR_MATCHES_PER_DAY}) reached with opponent ${row.opponent_id.slice(0, 8)}…`,
          evidence: { opponentId: row.opponent_id, matches24h: row.matches_24h },
          source: "rated_matches",
          available: true,
        });
      }
    } catch {
      pairCaps.available = false;
    }
  }

  // Linked accounts
  let linkedAccounts: {
    available: boolean;
    edges: Array<{
      peerId: string;
      reason: string;
      confidence: number;
      clusterId: string | null;
    }>;
    exclusions: Array<{ excludedId: string; reasonCode: string; expiresAt: string | null }>;
  } = { available: false, edges: [], exclusions: [] };

  if (hasIdentityEdges) {
    try {
      const edges = await listIdentityClusterEdges(profileId);
      linkedAccounts = {
        available: true,
        edges: edges.map((e) => ({
          peerId: e.accountId === profileId ? e.linkedAccountId : e.accountId,
          reason: e.reason,
          confidence: e.confidence,
          clusterId: e.clusterId,
        })),
        exclusions: [],
      };
      if (await tableExists("matchmaking_exclusions")) {
        const excl = await query<{
          excluded_account_id: string;
          reason_code: string;
          expires_at: string | null;
        }>(
          `select excluded_account_id::text, reason_code, expires_at
           from matchmaking_exclusions
           where account_id = $1::uuid
             and (expires_at is null or expires_at > now())`,
          [profileId],
        );
        linkedAccounts.exclusions = excl.rows.map((r) => ({
          excludedId: r.excluded_account_id,
          reasonCode: r.reason_code,
          expiresAt: r.expires_at,
        }));
      }
      for (const edge of linkedAccounts.edges) {
        signals.push({
          kind: "linked_account",
          status: "SIGNAL",
          summary: `Linked account edge (${edge.reason}) to ${edge.peerId.slice(0, 8)}…`,
          evidence: { peerId: edge.peerId, reason: edge.reason, confidence: edge.confidence },
          source: "identity_cluster_edges",
          available: true,
        });
      }
    } catch {
      linkedAccounts.available = false;
    }
  }

  // Rat-hole exits
  let ratHole: {
    available: boolean;
    exits: Array<{
      cityId: string;
      format: string;
      leavingStackAtoms: string;
      leftAt: string;
    }>;
  } = { available: false, exits: [] };

  if (hasRatHole) {
    try {
      const exits = await query<{
        city_id: string;
        format: string;
        leaving_stack_atoms: string;
        left_at: string;
      }>(
        `select city_id, format, leaving_stack_atoms::text, left_at
         from rat_hole_exits
         where owner_id = $1
         order by left_at desc
         limit 20`,
        [profileId],
      );
      ratHole = {
        available: true,
        exits: exits.rows.map((r) => ({
          cityId: r.city_id,
          format: r.format,
          leavingStackAtoms: r.leaving_stack_atoms,
          leftAt: r.left_at,
        })),
      };
      for (const exit of ratHole.exits) {
        signals.push({
          kind: "rat_hole",
          status: "SIGNAL",
          summary: `Recent deep cash-out in ${exit.cityId} (${exit.format})`,
          evidence: exit,
          source: "rat_hole_exits",
          available: true,
        });
      }
    } catch {
      ratHole.available = false;
    }
  }

  // Collusion signals + integrity cases
  let collusion: { available: boolean; open: Array<Record<string, unknown>> } = {
    available: false,
    open: [],
  };
  let integrityCases: { available: boolean; open: Array<Record<string, unknown>> } = {
    available: false,
    open: [],
  };

  if (hasCollusion) {
    try {
      const rows = await query(
        `select id::text, session_id, signal_kind, score, confidence, status, created_at
         from collusion_signals
         where $1::uuid = any(account_ids)
           and status in ('open', 'acknowledged')
         order by created_at desc
         limit 20`,
        [profileId],
      );
      collusion = { available: true, open: rows.rows as Record<string, unknown>[] };
      for (const row of rows.rows as Array<{ signal_kind: string; status: string; id: string }>) {
        signals.push({
          kind: "collusion_signal",
          status: row.status === "acknowledged" ? "REVIEW_REQUIRED" : "SIGNAL",
          summary: `Collusion signal: ${row.signal_kind}`,
          evidence: row as unknown as Record<string, unknown>,
          source: "collusion_signals",
          available: true,
        });
      }
    } catch {
      collusion.available = false;
    }
  }

  if (hasIntegrityCases) {
    try {
      const rows = await query(
        `select id::text, title, status, severity, created_at
         from integrity_cases
         where $1::uuid = any(account_ids)
           and status in ('open', 'investigating')
         order by created_at desc
         limit 20`,
        [profileId],
      );
      integrityCases = { available: true, open: rows.rows as Record<string, unknown>[] };
      for (const row of rows.rows as Array<{ title: string; severity: string; id: string }>) {
        signals.push({
          kind: "integrity_case",
          status: "REVIEW_REQUIRED",
          summary: `Open integrity case: ${row.title}`,
          evidence: row as unknown as Record<string, unknown>,
          source: "integrity_cases",
          available: true,
        });
      }
    } catch {
      integrityCases.available = false;
    }
  }

  const reviewStatus = deriveReviewStatus({
    ops,
    openCollusionCount: collusion.open.length,
    openCaseCount: integrityCases.open.length,
    signalCount: signals.filter((s) => s.status === "SIGNAL").length,
  });

  return {
    readOnly: true as const,
    workPacket: "MC-050" as const,
    schemaVersion: ADMIN_ECONOMICS_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    profileId,
    reviewStatus,
    adminFlags: {
      available: hasPlayerOps,
      restrictNewMatchmaking: ops?.restrictNewMatchmaking ?? false,
      underReview: ops?.underReview ?? false,
      requireIntegrityReview: ops?.requireIntegrityReview ?? false,
      updatedAt: ops?.updatedAt ?? null,
      updatedBy: ops?.updatedBy ?? null,
    },
    pairCaps,
    linkedAccounts,
    ratHole,
    collusion,
    integrityCases,
    signals,
    meta: {
      generatedAt: new Date().toISOString(),
      sources: [
        hasPairHistory ? "rated_matches" : null,
        hasIdentityEdges ? "identity_cluster_edges" : null,
        hasRatHole ? "rat_hole_exits" : null,
        hasCollusion ? "collusion_signals" : null,
        hasIntegrityCases ? "integrity_cases" : null,
        hasPlayerOps ? "admin_player_ops" : null,
      ].filter(Boolean),
    },
    notes: [
      "Signals are heuristics — never label a player a cheater from a single signal.",
      "No hole cards or raw chain-of-thought in integrity surfaces.",
    ],
  };
}

export async function getAdminPlayerResponsiblePlay(profileId: string) {
  if (!(await profileExists(profileId))) return null;

  const profile = await query<{ profile_kind: string }>(
    `select profile_kind::text from profiles where id = $1::uuid limit 1`,
    [profileId],
  ).catch(() => ({ rows: [] as Array<{ profile_kind: string }> }));

  const row = profile.rows[0];
  if (!row) return null;

  // No dedicated responsible-play tables yet — best-effort from profile + admin flags.
  const ops = await getPlayerOps(profileId);
  const hasResponsiblePlayTable = await tableExists("responsible_play_limits");

  let userLimits: { available: boolean; limits: unknown[] } = { available: false, limits: [] };
  if (hasResponsiblePlayTable) {
    try {
      const limits = await query(
        `select * from responsible_play_limits where profile_id = $1::uuid`,
        [profileId],
      );
      userLimits = { available: true, limits: limits.rows };
    } catch {
      userLimits.available = false;
    }
  }

  return {
    readOnly: true as const,
    workPacket: "MC-053" as const,
    generatedAt: new Date().toISOString(),
    profileId,
    profileKind: row.profile_kind,
    accountLock: {
      available: false,
      locked: false,
      reason: null as string | null,
    },
    selfExclusion: userLimits,
    depositCaps: { available: false, status: "UNAVAILABLE" as const },
    sessionCaps: { available: false, status: "UNAVAILABLE" as const },
    coolingOff: { available: false, status: "UNAVAILABLE" as const },
    adminRestrictions: {
      available: Boolean(ops),
      restrictNewMatchmaking: ops?.restrictNewMatchmaking ?? false,
      underReview: ops?.underReview ?? false,
    },
    meta: {
      generatedAt: new Date().toISOString(),
      note: "User-originated responsible-play limits surface as UNAVAILABLE until product ships dedicated tables.",
    },
  };
}

export type TimelineEntry = {
  at: string;
  kind: string;
  summary: string;
  source: string;
  entityId: string | null;
  detail: Record<string, unknown> | null;
};

export async function getAdminPlayerTimeline(profileId: string, limit = 100) {
  if (!(await profileExists(profileId))) return null;

  const bounded = Math.min(Math.max(limit, 1), 200);
  const entries: TimelineEntry[] = [];

  const walletRow = await query<{ address: string }>(
    `select lower(address) as address from wallet_identities where profile_id = $1::uuid limit 1`,
    [profileId],
  ).catch(() => ({ rows: [] as Array<{ address: string }> }));
  const wallet = walletRow.rows[0]?.address ?? null;

  // Admin actions on this profile
  try {
    const actions = await listAdminActions({ limit: bounded, entityType: "profile", entityId: profileId });
    for (const a of actions) {
      entries.push({
        at: a.createdAt,
        kind: "admin_action",
        summary: a.action,
        source: "admin_actions",
        entityId: a.id,
        detail: { reason: a.reason, actorLabel: a.actorLabel, capability: a.capability },
      });
    }
  } catch {
    /* best-effort */
  }

  // Session joins
  try {
    const sessions = await query<{
      session_id: string;
      status: string;
      created_at: string;
      settled_at: string | null;
    }>(
      `select os.session_id, os.status, os.created_at, os.settled_at
       from onchain_session_players osp
       join onchain_sessions os on os.session_id = osp.session_id
       where osp.profile_id = $1::uuid
       order by os.created_at desc
       limit 30`,
      [profileId],
    );
    for (const s of sessions.rows) {
      entries.push({
        at: s.created_at,
        kind: "session_join",
        summary: `Session ${s.session_id.slice(0, 12)}… (${s.status})`,
        source: "onchain_sessions",
        entityId: s.session_id,
        detail: { status: s.status, settledAt: s.settled_at },
      });
    }
  } catch {
    /* best-effort */
  }

  // Funding events
  if (wallet) {
    try {
      const deposits = await query<{ tx_hash: string; amount_raw: string; created_at: string }>(
        `select tx_hash, amount_raw::text, created_at
         from vault_deposits
         where lower(wallet_address) = $1
         order by created_at desc
         limit 20`,
        [wallet],
      );
      for (const d of deposits.rows) {
        entries.push({
          at: d.created_at,
          kind: "deposit",
          summary: `Vault deposit`,
          source: "vault_deposits",
          entityId: d.tx_hash,
          detail: { amountRaw: d.amount_raw },
        });
      }
      const withdrawals = await query<{ tx_hash: string; amount_raw: string; created_at: string }>(
        `select tx_hash, amount_raw::text, created_at
         from vault_withdrawals
         where lower(wallet_address) = $1
         order by created_at desc
         limit 20`,
        [wallet],
      );
      for (const w of withdrawals.rows) {
        entries.push({
          at: w.created_at,
          kind: "withdrawal",
          summary: `Vault withdrawal`,
          source: "vault_withdrawals",
          entityId: w.tx_hash,
          detail: { amountRaw: w.amount_raw },
        });
      }
    } catch {
      /* best-effort */
    }
  }

  // Rating updates
  try {
    const ratings = await query<{
      pool_id: string;
      rating: string;
      recorded_at: string;
    }>(
      `select pool_id, rating::text, recorded_at
       from rating_history
       where owner_id = $1::uuid
       order by recorded_at desc
       limit 20`,
      [profileId],
    );
    for (const r of ratings.rows) {
      entries.push({
        at: r.recorded_at,
        kind: "rating_update",
        summary: `Rating ${Math.round(Number(r.rating))} (${r.pool_id})`,
        source: "rating_history",
        entityId: r.pool_id,
        detail: { rating: r.rating },
      });
    }
  } catch {
    /* best-effort */
  }

  // Matchmaking intents
  if (await tableExists("matchmaking_intents")) {
    try {
      const intents = await query<{
        id: string;
        status: string;
        league_id: string;
        created_at: string;
      }>(
        `select id::text, status, league_id, created_at
         from matchmaking_intents
         where profile_id = $1::uuid
         order by created_at desc
         limit 20`,
        [profileId],
      );
      for (const i of intents.rows) {
        entries.push({
          at: i.created_at,
          kind: "matchmaking",
          summary: `Matchmaking ${i.status} (${i.league_id})`,
          source: "matchmaking_intents",
          entityId: i.id,
          detail: { status: i.status, leagueId: i.league_id },
        });
      }
    } catch {
      /* best-effort */
    }
  }

  entries.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  return {
    readOnly: true as const,
    workPacket: "MC-054" as const,
    generatedAt: new Date().toISOString(),
    profileId,
    timeline: entries.slice(0, bounded),
    meta: {
      generatedAt: new Date().toISOString(),
      count: Math.min(entries.length, bounded),
      sources: ["admin_actions", "onchain_sessions", "vault_deposits", "rating_history", "matchmaking_intents"],
      note: "Best-effort aggregation — not exhaustive for all event types.",
    },
  };
}

export async function requestPlayerReplay(input: {
  profileId: string;
  sessionId?: string | null;
  reason: string;
  role: string;
  actorLabel?: string | null;
  requestId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<{
  ok: true;
  sessionId: string;
  ops: unknown;
  auditId: string;
  playerAuditId: string;
}> {
  const reason = input.reason.trim();
  if (!reason) throw new Error("reason_required");
  if (!(await profileExists(input.profileId))) throw new Error("player_not_found");

  let sessionId = input.sessionId?.trim() || null;
  if (!sessionId) {
    const recent = await query<{ session_id: string }>(
      `select os.session_id
       from onchain_session_players osp
       join onchain_sessions os on os.session_id = osp.session_id
       where osp.profile_id = $1::uuid
       order by os.created_at desc
       limit 1`,
      [input.profileId],
    );
    sessionId = recent.rows[0]?.session_id ?? null;
  }
  if (!sessionId) throw new Error("no_session_for_replay");

  const belongs = await query(
    `select 1 from onchain_session_players
     where profile_id = $1::uuid and session_id = $2 limit 1`,
    [input.profileId, sessionId],
  );
  if (!belongs.rows[0]) throw new Error("session_not_linked_to_player");

  const result = await mutateSessionOps({
    sessionId,
    action: "request_replay",
    reason,
    role: input.role,
    actorLabel: input.actorLabel,
    requestId: input.requestId,
    ip: input.ip,
    userAgent: input.userAgent,
  });

  const { id: playerAuditId } = await appendAdminAction({
    action: "player.request_replay",
    role: input.role,
    actorLabel: input.actorLabel,
    reason,
    entityType: "profile",
    entityId: input.profileId,
    capability: "mutate",
    newState: { sessionId, sessionOpsAuditId: result.auditId },
    requestId: input.requestId,
    ip: input.ip,
    userAgent: input.userAgent,
  });

  return {
    ok: true,
    sessionId,
    ops: result.ops,
    auditId: result.auditId,
    playerAuditId,
  };
}

export async function getRiskOverview() {
  const hasPlayerOps = await tableExists("admin_player_ops");
  const hasCollusion = await tableExists("collusion_signals");

  let restrictedPlayers: Array<{
    profileId: string;
    handle: string;
    displayName: string;
    restrictNewMatchmaking: boolean;
    underReview: boolean;
    requireIntegrityReview: boolean;
    updatedAt: string | null;
  }> = [];

  if (hasPlayerOps) {
    try {
      const rows = await query<{
        profile_id: string;
        handle: string;
        display_name: string;
        restrict_new_matchmaking: boolean;
        under_review: boolean;
        require_integrity_review: boolean;
        updated_at: string;
      }>(
        `select apo.profile_id::text, p.handle, p.display_name,
                apo.restrict_new_matchmaking, apo.under_review, apo.require_integrity_review,
                apo.updated_at
         from admin_player_ops apo
         join profiles p on p.id = apo.profile_id
         where apo.restrict_new_matchmaking or apo.under_review or apo.require_integrity_review
         order by apo.updated_at desc
         limit 50`,
      );
      restrictedPlayers = rows.rows.map((r) => ({
        profileId: r.profile_id,
        handle: r.handle,
        displayName: r.display_name,
        restrictNewMatchmaking: r.restrict_new_matchmaking,
        underReview: r.under_review,
        requireIntegrityReview: r.require_integrity_review,
        updatedAt: r.updated_at,
      }));
    } catch {
      restrictedPlayers = [];
    }
  }

  let openCollusionCount = 0;
  if (hasCollusion) {
    try {
      const count = await query<{ n: string }>(
        `select count(*)::text as n from collusion_signals where status = 'open'`,
      );
      openCollusionCount = Number(count.rows[0]?.n ?? 0);
    } catch {
      openCollusionCount = 0;
    }
  }

  return {
    readOnly: true as const,
    workPacket: "MC-050" as const,
    generatedAt: new Date().toISOString(),
    restrictedPlayers,
    openCollusionSignals: hasCollusion
      ? { available: true, count: openCollusionCount }
      : { available: false, count: null },
    adminPlayerOps: hasPlayerOps ? { available: true } : { available: false, status: "UNAVAILABLE" },
    notes: [
      "Risk overview lists admin-flagged players only — run player integrity for full signal aggregation.",
    ],
  };
}
