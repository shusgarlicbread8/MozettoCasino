/**
 * Plan 19 public API surface aliases.
 * Thin wrappers over existing Arena / rankings / table / seat-ticket routes.
 * Does not invent new money or poker authority writers.
 */
import type { FastifyInstance } from "fastify";
import { query, ensureAccountRatings } from "@mozetto/database";
import { requireUser } from "./auth.js";

export function registerPlan19Routes(app: FastifyInstance) {
  /** Plan 19: GET /v1/me/arena-account → existing /v1/arena/account handler via redirect body. */
  app.get("/v1/me/arena-account", async (req, reply) => {
    // Delegate by re-issuing internally — clients may call either path.
    return app.inject({
      method: "GET",
      url: "/v1/arena/account",
      headers: req.headers as Record<string, string>,
      cookies: (req as { cookies?: Record<string, string> }).cookies,
    }).then((res) => {
      reply.code(res.statusCode);
      for (const [k, v] of Object.entries(res.headers)) {
        if (k.toLowerCase() === "transfer-encoding") continue;
        if (v !== undefined) reply.header(k, v);
      }
      try {
        return JSON.parse(res.body);
      } catch {
        return res.body;
      }
    });
  });

  app.get("/v1/me/game-permissions", async (req, reply) => {
    const session = await requireUser(req, reply);
    if (!session) return;
    return {
      profileId: session.profileId,
      note: "Use POST /v1/arena/game-permission to prepare/submit on-chain GamePermission.",
      prepare: "POST /v1/arena/game-permission",
      legacyAliases: {
        prepare: "POST /v1/me/game-permissions/prepare",
        submit: "POST /v1/me/game-permissions/submit",
        revoke: "POST /v1/me/game-permissions/revoke",
      },
    };
  });

  for (const path of [
    "/v1/me/game-permissions/prepare",
    "/v1/me/game-permissions/submit",
  ] as const) {
    app.post(path, async (req, reply) => {
      return app.inject({
        method: "POST",
        url: "/v1/arena/game-permission",
        headers: {
          ...(req.headers as Record<string, string>),
          "content-type": "application/json",
        },
        payload: (req.body ?? {}) as Record<string, unknown>,
      }).then((res) => {
        reply.code(res.statusCode);
        try {
          return JSON.parse(res.body);
        } catch {
          return res.body;
        }
      });
    });
  }

  app.post("/v1/me/game-permissions/revoke", async (_req, reply) => {
    return reply.code(501).send({
      error: "not_implemented",
      message: "On-chain GamePermission revoke is owner-wallet initiated; no server mutate path.",
    });
  });

  /** Matchmaking intents — coordination rows; ranked allocation still via find-match. */
  app.post("/v1/matchmaking/intents", async (req, reply) => {
    const session = await requireUser(req, reply);
    if (!session) return;
    const body = (req.body ?? {}) as {
      leagueId?: string;
      format?: string;
      buyIn?: number;
      idempotencyKey?: string;
    };
    const format = body.format === "classic" ? "classic" : "hu";
    const leagueId = body.leagueId ?? (format === "classic" ? "classic" : "bronze");
    const idem = body.idempotencyKey ?? null;
    try {
      const res = await query<{ id: string; status: string }>(
        `insert into matchmaking_intents (
           profile_id, league_id, format, arena_mode, chain_id, buy_in, idempotency_key, status
         ) values ($1, $2, $3, $4, $5, $6, $7, 'queued')
         on conflict (profile_id, idempotency_key) do update set updated_at = now()
         returning id::text, status`,
        [
          session.profileId,
          leagueId,
          format,
          session.profileKind === "onchain" ? "onchain" : "demo",
          session.chainId ?? null,
          body.buyIn ?? null,
          idem,
        ],
      );
      return {
        intent: res.rows[0],
        next: {
          findMatch:
            format === "classic"
              ? "POST /v1/arena/classic/find-match"
              : "POST /v1/arena/find-match",
        },
      };
    } catch (e) {
      return reply.code(503).send({
        error: "intents_unavailable",
        message: e instanceof Error ? e.message : "matchmaking_intents not migrated",
      });
    }
  });

  app.get("/v1/matchmaking/intents/:id", async (req, reply) => {
    const session = await requireUser(req, reply);
    if (!session) return;
    const id = (req.params as { id: string }).id;
    try {
      const res = await query(
        `select id::text, league_id, format, status, session_id, table_id, created_at, updated_at
         from matchmaking_intents
         where id = $1::uuid and profile_id = $2`,
        [id, session.profileId],
      );
      if (!res.rows[0]) return reply.code(404).send({ error: "not_found" });
      return { intent: res.rows[0] };
    } catch {
      return reply.code(503).send({ error: "intents_unavailable" });
    }
  });

  app.delete("/v1/matchmaking/intents/:id", async (req, reply) => {
    const session = await requireUser(req, reply);
    if (!session) return;
    const id = (req.params as { id: string }).id;
    try {
      const res = await query(
        `update matchmaking_intents
         set status = 'cancelled', updated_at = now()
         where id = $1::uuid and profile_id = $2 and status = 'queued'
         returning id::text, status`,
        [id, session.profileId],
      );
      if (!res.rows[0]) return reply.code(404).send({ error: "not_found_or_not_queued" });
      return { intent: res.rows[0] };
    } catch {
      return reply.code(503).send({ error: "intents_unavailable" });
    }
  });

  app.get("/v1/matchmaking/pools", async () => {
    const stats = await query(
      `select matchmaking_pool as pool, status, count(*)::int as tickets
       from seat_tickets
       where status in ('queued', 'matched')
       group by matchmaking_pool, status
       order by matchmaking_pool`,
    ).catch(() => ({ rows: [] as Record<string, unknown>[] }));
    return {
      pools: stats.rows,
      note: "Public pool occupancy only; anti-fraud signals are not exposed.",
    };
  });

  app.get("/v1/sessions/:id/public", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const onchain = await query(
      `select session_id, chain_id, game_template_id, status, lifecycle_state, attestation_class,
              last_sequence, last_balance_root, last_event_root, open_tx_hash, settlement_tx_hash,
              created_at, opened_at, settled_at
       from onchain_sessions where session_id = $1`,
      [id],
    ).catch(() => ({ rows: [] as Record<string, unknown>[] }));
    if (onchain.rows[0]) {
      return { kind: "onchain_session", session: onchain.rows[0] };
    }
    const table = await query(
      `select id, name, status, game_id, league_id, max_seats, small_blind, big_blind, created_at
       from tables where id = $1`,
      [id],
    ).catch(() => ({ rows: [] as Record<string, unknown>[] }));
    if (table.rows[0]) {
      return { kind: "table", table: table.rows[0] };
    }
    return reply.code(404).send({ error: "not_found" });
  });

  app.get("/v1/sessions/:id/my-private-summary", async (req, reply) => {
    const session = await requireUser(req, reply);
    if (!session) return;
    const id = (req.params as { id: string }).id;
    const seat = await query(
      `select ts.table_id, ts.seat_index, ts.stack, ts.status, t.name
       from table_seats ts
       join tables t on t.id = ts.table_id
       where (ts.table_id = $1 or ts.owner_id = $2) and ts.owner_id = $2
       limit 5`,
      [id, session.profileId],
    ).catch(() => ({ rows: [] as Record<string, unknown>[] }));
    return {
      sessionId: id,
      seats: seat.rows,
      note: "Hole cards and private AgentState are never returned on HTTP; use authenticated game WS private_state_v2.",
    };
  });

  app.post("/v1/sessions/:id/request-leave", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    return app.inject({
      method: "POST",
      url: `/v1/tables/${encodeURIComponent(id)}/leave`,
      headers: {
        ...(req.headers as Record<string, string>),
        "content-type": "application/json",
      },
      payload: {},
    }).then((res) => {
      reply.code(res.statusCode);
      try {
        return JSON.parse(res.body);
      } catch {
        return res.body;
      }
    });
  });

  app.post("/v1/sessions/:id/queue-next-profile", async (req, reply) => {
    const session = await requireUser(req, reply);
    if (!session) return;
    const id = (req.params as { id: string }).id;
    const body = (req.body ?? {}) as { profileKey?: string; idempotencyKey?: string };
    try {
      const res = await query(
        `insert into queued_seat_changes (
           table_id, target_epoch, change_type, status, owner_id, profile_key, idempotency_key, payload
         ) values (
           $1,
           coalesce((select max(epoch_number) from table_epochs where table_id = $1 and status = 'open'), 1),
           'join',
           'pending',
           $2,
           $3,
           $4,
           '{}'::jsonb
         )
         on conflict (table_id, idempotency_key) do update set payload = excluded.payload
         returning id::text, status, target_epoch`,
        [id, session.profileId, body.profileKey ?? null, body.idempotencyKey ?? null],
      );
      return { queued: res.rows[0] };
    } catch (e) {
      return reply.code(503).send({
        error: "queue_unavailable",
        message: e instanceof Error ? e.message : "queued_seat_changes unavailable",
      });
    }
  });

  app.get("/v1/tables/:id/snapshot", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    return app.inject({
      method: "GET",
      url: `/v1/tables/${encodeURIComponent(id)}`,
      headers: req.headers as Record<string, string>,
    }).then((res) => {
      reply.code(res.statusCode);
      try {
        return JSON.parse(res.body);
      } catch {
        return res.body;
      }
    });
  });

  app.get("/v1/hands/:id/public", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    return app.inject({
      method: "GET",
      url: `/v1/replays/${encodeURIComponent(id)}`,
      headers: req.headers as Record<string, string>,
    }).then((res) => {
      reply.code(res.statusCode);
      try {
        return JSON.parse(res.body);
      } catch {
        return res.body;
      }
    });
  });

  app.get("/v1/sessions/:id/replay", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    return app.inject({
      method: "GET",
      url: `/v1/verify/session/${encodeURIComponent(id)}/events`,
      headers: req.headers as Record<string, string>,
    }).then((res) => {
      reply.code(res.statusCode);
      try {
        return JSON.parse(res.body);
      } catch {
        return res.body;
      }
    });
  });

  app.get("/v1/ratings/leaderboard", async (req, reply) => {
    const qs = new URLSearchParams(req.query as Record<string, string>).toString();
    return app.inject({
      method: "GET",
      url: `/v1/rankings${qs ? `?${qs}` : ""}`,
      headers: req.headers as Record<string, string>,
    }).then((res) => {
      reply.code(res.statusCode);
      try {
        return JSON.parse(res.body);
      } catch {
        return res.body;
      }
    });
  });

  app.get("/v1/ratings/me", async (req, reply) => {
    const session = await requireUser(req, reply);
    if (!session) return;
    await ensureAccountRatings(session.profileId).catch(() => null);
    const pool = String((req.query as { pool?: string }).pool ?? "hu_holdem_standard");
    const res = await query(
      `select pool_id, rating, rd, volatility, matches_played, wins, losses, hands_played, provisional
       from account_ratings where owner_id = $1 and pool_id = $2`,
      [session.profileId, pool],
    );
    return { pool, rating: res.rows[0] ?? null };
  });

  app.get("/v1/profiles/:id/style-metrics", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const byHandle = await query(
      `select a.owner_id from profiles p
       join agent_identities a on a.owner_id = p.id
       where p.handle = $1 or p.id::text = $1
       limit 1`,
      [id],
    ).catch(() => ({ rows: [] as { owner_id: string }[] }));
    const ownerId = byHandle.rows[0]?.owner_id ?? id;
    const stats = await query(
      `select * from aggression_stats where owner_id = $1::uuid limit 5`,
      [ownerId],
    ).catch(() => ({ rows: [] as Record<string, unknown>[] }));
    return {
      ownerId,
      aggression: stats.rows,
      note: "Descriptive style metrics only; never an input to Arena Rating (Plan 12).",
    };
  });
}
