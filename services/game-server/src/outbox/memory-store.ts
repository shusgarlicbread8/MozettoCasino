/**
 * In-process outbox for unit tests and single-process dry runs.
 */
import { randomUUID } from "node:crypto";
import type {
  AppendOutboxInput,
  OutboxMessage,
  OutboxStore,
} from "./types.js";

export class MemoryOutboxStore implements OutboxStore {
  private readonly rows = new Map<string, OutboxMessage>();

  clear(): void {
    this.rows.clear();
  }

  /** Test helper — inspect all rows. */
  all(): OutboxMessage[] {
    return [...this.rows.values()].sort((a, b) => a.sequence - b.sequence);
  }

  private key(sessionId: string, epoch: number, sequence: number): string {
    return `${sessionId}:${epoch}:${sequence}`;
  }

  async appendPending(input: AppendOutboxInput): Promise<OutboxMessage> {
    const epoch = input.epoch ?? 0;
    const k = this.key(input.sessionId, epoch, input.sequence);
    const existing = [...this.rows.values()].find(
      (r) => r.sessionId === input.sessionId && r.epoch === epoch && r.sequence === input.sequence,
    );
    if (existing?.status === "published") {
      return existing;
    }
    const msg: OutboxMessage = {
      id: existing?.id ?? randomUUID(),
      sessionId: input.sessionId,
      tableId: input.tableId ?? null,
      epoch,
      sequence: input.sequence,
      eventHash: input.eventHash,
      channel: input.channel ?? "table:public",
      payload: input.payload,
      schemaKind: input.schemaKind ?? "legacy_json",
      visibility: input.visibility ?? "public",
      status: "pending",
      attempts: 0,
      lastError: null,
      createdAtMs: existing?.createdAtMs ?? Date.now(),
      publishedAtMs: null,
    };
    this.rows.set(msg.id, msg);
    // Keep uniqueness by session/epoch/seq — drop stale id if replaced.
    if (existing && existing.id !== msg.id) this.rows.delete(existing.id);
    void k;
    return { ...msg, payload: { ...msg.payload } };
  }

  async markPublished(id: string): Promise<void> {
    const cur = this.rows.get(id);
    if (!cur) return;
    this.rows.set(id, {
      ...cur,
      status: "published",
      publishedAtMs: Date.now(),
      lastError: null,
    });
  }

  async markFailed(id: string, error: string): Promise<void> {
    const cur = this.rows.get(id);
    if (!cur) return;
    this.rows.set(id, {
      ...cur,
      status: "failed",
      attempts: cur.attempts + 1,
      lastError: error.slice(0, 2000),
    });
  }

  async bumpAttempt(id: string, error: string): Promise<void> {
    const cur = this.rows.get(id);
    if (!cur) return;
    this.rows.set(id, {
      ...cur,
      status: "pending",
      attempts: cur.attempts + 1,
      lastError: error.slice(0, 2000),
    });
  }

  async listPending(opts?: {
    tableId?: string;
    sessionId?: string;
    limit?: number;
  }): Promise<OutboxMessage[]> {
    let rows = [...this.rows.values()].filter((r) => r.status === "pending");
    if (opts?.tableId) rows = rows.filter((r) => r.tableId === opts.tableId);
    if (opts?.sessionId) rows = rows.filter((r) => r.sessionId === opts.sessionId);
    rows.sort((a, b) => a.createdAtMs - b.createdAtMs || a.sequence - b.sequence);
    const limit = opts?.limit ?? 500;
    return rows.slice(0, limit).map((r) => ({ ...r, payload: { ...r.payload } }));
  }
}
