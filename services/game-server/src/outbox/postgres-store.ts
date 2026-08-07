/**
 * Postgres outbox store backed by `event_persistence_outbox` (WP-081 / migration 020).
 */
import {
  bumpOutboxAttempt,
  insertOutboxPending,
  listPendingOutbox,
  markOutboxFailed,
  markOutboxPublished,
  type OutboxRow,
} from "@mozetto/database";
import type { AppendOutboxInput, OutboxMessage, OutboxStore } from "./types.js";

function fromRow(row: OutboxRow): OutboxMessage {
  return {
    id: row.id,
    sessionId: row.sessionId,
    tableId: row.tableId,
    epoch: row.epoch,
    sequence: row.sequence,
    eventHash: row.eventHash,
    channel: row.channel,
    payload: row.payload,
    schemaKind: row.schemaKind,
    visibility: row.visibility,
    status: row.status,
    attempts: row.attempts,
    lastError: row.lastError,
    createdAtMs: Date.parse(row.createdAt) || Date.now(),
    publishedAtMs: row.publishedAt ? Date.parse(row.publishedAt) : null,
  };
}

export class PostgresOutboxStore implements OutboxStore {
  async appendPending(input: AppendOutboxInput): Promise<OutboxMessage> {
    const row = await insertOutboxPending({
      sessionId: input.sessionId,
      tableId: input.tableId,
      epoch: input.epoch,
      sequence: input.sequence,
      eventHash: input.eventHash,
      channel: input.channel,
      payload: input.payload,
      schemaKind: input.schemaKind,
      visibility: input.visibility,
    });
    return fromRow(row);
  }

  async markPublished(id: string): Promise<void> {
    await markOutboxPublished(id);
  }

  async markFailed(id: string, error: string): Promise<void> {
    await markOutboxFailed(id, error);
  }

  async bumpAttempt(id: string, error: string): Promise<void> {
    await bumpOutboxAttempt(id, error);
  }

  async listPending(opts?: {
    tableId?: string;
    sessionId?: string;
    limit?: number;
  }): Promise<OutboxMessage[]> {
    const rows = await listPendingOutbox(opts);
    return rows.map(fromRow);
  }
}
