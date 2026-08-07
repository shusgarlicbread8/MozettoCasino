/**
 * WP-081 — Persist-before-broadcast outbox SQL helpers (Plan 07 / migration 019+020).
 *
 * Rows live in `event_persistence_outbox` (view: `broadcast_outbox`).
 * Publisher marks `published` only after WS delivery attempt succeeds.
 */
import { query, withTransaction, type DbClient } from "./client.js";

export type OutboxSchemaKind = "legacy_json" | "poker_event_v1";
export type OutboxStatus = "pending" | "published" | "failed";
export type OutboxVisibility = "public" | "owner_private" | "system";

export type OutboxRow = {
  id: string;
  sessionId: string;
  tableId: string | null;
  epoch: number;
  sequence: number;
  eventHash: string;
  channel: string;
  payload: Record<string, unknown>;
  schemaKind: OutboxSchemaKind;
  visibility: OutboxVisibility;
  status: OutboxStatus;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  publishedAt: string | null;
};

export type InsertOutboxInput = {
  sessionId: string;
  tableId?: string | null;
  epoch?: number;
  sequence: number;
  eventHash: string;
  channel?: string;
  payload: Record<string, unknown>;
  schemaKind?: OutboxSchemaKind;
  visibility?: OutboxVisibility;
};

function mapRow(r: Record<string, unknown>): OutboxRow {
  const payload = r.payload;
  return {
    id: String(r.id),
    sessionId: String(r.session_id),
    tableId: r.table_id != null ? String(r.table_id) : null,
    epoch: Number(r.epoch ?? 0),
    sequence: Number(r.sequence),
    eventHash: String(r.event_hash),
    channel: String(r.channel ?? "table:public"),
    payload:
      payload && typeof payload === "object" && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : typeof payload === "string"
          ? (JSON.parse(payload) as Record<string, unknown>)
          : {},
    schemaKind: (r.schema_kind as OutboxSchemaKind) ?? "legacy_json",
    visibility: (r.visibility as OutboxVisibility) ?? "public",
    status: r.status as OutboxStatus,
    attempts: Number(r.attempts ?? 0),
    lastError: r.last_error != null ? String(r.last_error) : null,
    createdAt: String(r.created_at),
    publishedAt: r.published_at != null ? String(r.published_at) : null,
  };
}

const SELECT_COLS = `
  id, session_id, table_id, epoch, sequence, event_hash, channel, payload,
  schema_kind, visibility, status, attempts, last_error, created_at, published_at
`;

export async function insertOutboxPending(
  input: InsertOutboxInput,
  client?: DbClient,
): Promise<OutboxRow> {
  const q = client?.query.bind(client) ?? query;
  const res = await q(
    `insert into event_persistence_outbox
       (session_id, table_id, epoch, sequence, event_hash, channel, payload, schema_kind, visibility, status)
     values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,'pending')
     on conflict (session_id, epoch, sequence) do update set
       event_hash = excluded.event_hash,
       channel = excluded.channel,
       payload = excluded.payload,
       schema_kind = excluded.schema_kind,
       visibility = excluded.visibility,
       status = case
         when event_persistence_outbox.status = 'published' then 'published'
         else 'pending'
       end,
       attempts = case
         when event_persistence_outbox.status = 'published' then event_persistence_outbox.attempts
         else 0
       end,
       last_error = case
         when event_persistence_outbox.status = 'published' then event_persistence_outbox.last_error
         else null
       end
     returning ${SELECT_COLS}`,
    [
      input.sessionId,
      input.tableId ?? null,
      input.epoch ?? 0,
      input.sequence,
      input.eventHash,
      input.channel ?? "table:public",
      JSON.stringify(input.payload),
      input.schemaKind ?? "legacy_json",
      input.visibility ?? "public",
    ],
  );
  return mapRow(res.rows[0] as Record<string, unknown>);
}

export async function markOutboxPublished(id: string, client?: DbClient): Promise<void> {
  const q = client?.query.bind(client) ?? query;
  await q(
    `update event_persistence_outbox
     set status = 'published', published_at = now(), last_error = null
     where id = $1`,
    [id],
  );
}

export async function markOutboxFailed(
  id: string,
  error: string,
  client?: DbClient,
): Promise<void> {
  const q = client?.query.bind(client) ?? query;
  await q(
    `update event_persistence_outbox
     set status = 'failed', attempts = attempts + 1, last_error = $2
     where id = $1`,
    [id, error.slice(0, 2000)],
  );
}

/**
 * Transient publish failure: keep `pending` so restart recovery retries,
 * but record attempts + last_error.
 */
export async function bumpOutboxAttempt(
  id: string,
  error: string,
  client?: DbClient,
): Promise<void> {
  const q = client?.query.bind(client) ?? query;
  await q(
    `update event_persistence_outbox
     set status = 'pending', attempts = attempts + 1, last_error = $2
     where id = $1`,
    [id, error.slice(0, 2000)],
  );
}

export async function listPendingOutbox(opts?: {
  tableId?: string;
  sessionId?: string;
  limit?: number;
}): Promise<OutboxRow[]> {
  const limit = opts?.limit ?? 500;
  if (opts?.tableId) {
    const res = await query(
      `select ${SELECT_COLS}
       from event_persistence_outbox
       where status = 'pending' and table_id = $1
       order by created_at asc, sequence asc
       limit $2`,
      [opts.tableId, limit],
    );
    return res.rows.map((r) => mapRow(r as Record<string, unknown>));
  }
  if (opts?.sessionId) {
    const res = await query(
      `select ${SELECT_COLS}
       from event_persistence_outbox
       where status = 'pending' and session_id = $1
       order by epoch asc, sequence asc
       limit $2`,
      [opts.sessionId, limit],
    );
    return res.rows.map((r) => mapRow(r as Record<string, unknown>));
  }
  const res = await query(
    `select ${SELECT_COLS}
     from event_persistence_outbox
     where status = 'pending'
     order by created_at asc
     limit $1`,
    [limit],
  );
  return res.rows.map((r) => mapRow(r as Record<string, unknown>));
}

/**
 * Durable write + outbox append in one transaction.
 * Caller supplies additional inserts via `write`; outbox row is appended after.
 */
export async function persistWithOutbox<T>(opts: {
  outbox: InsertOutboxInput;
  write: (client: DbClient) => Promise<T>;
}): Promise<{ result: T; outbox: OutboxRow }> {
  return withTransaction(async (client) => {
    const result = await opts.write(client);
    const outbox = await insertOutboxPending(opts.outbox, client);
    return { result, outbox };
  });
}
