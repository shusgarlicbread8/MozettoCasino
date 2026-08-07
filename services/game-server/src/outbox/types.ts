/**
 * WP-081 — Persist-before-broadcast outbox types (Plan 07).
 *
 * Pipeline: durable write → outbox pending → COMMIT → publish → mark published.
 * Never broadcast an authoritative event before durable persistence.
 */

export type SchemaKind = "legacy_json" | "poker_event_v1";
export type OutboxVisibility = "public" | "owner_private" | "system";
export type OutboxStatus = "pending" | "published" | "failed";

export type OutboxMessage = {
  id: string;
  sessionId: string;
  tableId: string | null;
  epoch: number;
  sequence: number;
  eventHash: string;
  channel: string;
  payload: Record<string, unknown>;
  schemaKind: SchemaKind;
  visibility: OutboxVisibility;
  status: OutboxStatus;
  attempts: number;
  lastError: string | null;
  createdAtMs: number;
  publishedAtMs: number | null;
};

export type AppendOutboxInput = {
  sessionId: string;
  tableId?: string | null;
  epoch?: number;
  sequence: number;
  eventHash: string;
  channel?: string;
  payload: Record<string, unknown>;
  schemaKind?: SchemaKind;
  visibility?: OutboxVisibility;
};

export type DurableWriteFn = () => Promise<void>;

export interface OutboxStore {
  /** Append pending row. Must be called inside the same durable transaction as the event write when using Postgres. */
  appendPending(input: AppendOutboxInput): Promise<OutboxMessage>;
  markPublished(id: string): Promise<void>;
  /** Permanent failure (optional); prefer bumpAttempt for transient WS errors. */
  markFailed(id: string, error: string): Promise<void>;
  /** Keep pending + increment attempts after a transient publish failure. */
  bumpAttempt(id: string, error: string): Promise<void>;
  listPending(opts?: {
    tableId?: string;
    sessionId?: string;
    limit?: number;
  }): Promise<OutboxMessage[]>;
}

export type PublishFn = (msg: OutboxMessage) => void | Promise<void>;

export type PersistThenBroadcastResult = {
  message: OutboxMessage;
  published: boolean;
  recovered?: boolean;
};
