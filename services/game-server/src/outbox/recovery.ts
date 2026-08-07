/**
 * WP-081 — Restart recovery for undelivered outbox rows.
 */
import { drainPendingOutbox } from "./pipeline.js";
import type { OutboxMessage, OutboxStore, PublishFn } from "./types.js";

export type OutboxRecoveryResult = {
  ok: boolean;
  drained: number;
  failed: number;
  remainingPending: number;
  messages: OutboxMessage[];
};

/**
 * After table-actor lease acquire / process restart: republish pending outbox
 * for this table before accepting new authoritative actions.
 */
export async function recoverUndeliveredOutbox(opts: {
  store: OutboxStore;
  publish: PublishFn;
  tableId: string;
  sessionId?: string;
  limit?: number;
}): Promise<OutboxRecoveryResult> {
  const first = await drainPendingOutbox({
    store: opts.store,
    publish: opts.publish,
    tableId: opts.tableId,
    limit: opts.limit,
  });

  let drained = first.drained;
  let failed = first.failed;
  const messages = [...first.messages];

  if (opts.sessionId) {
    const second = await drainPendingOutbox({
      store: opts.store,
      publish: opts.publish,
      sessionId: opts.sessionId,
      limit: opts.limit,
    });
    // Avoid double-counting same ids.
    const seen = new Set(messages.map((m) => m.id));
    for (const m of second.messages) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      messages.push(m);
      if (m.status === "published") drained += 1;
      else failed += 1;
    }
  }

  const still = await opts.store.listPending({
    tableId: opts.tableId,
    limit: opts.limit ?? 500,
  });

  return {
    ok: failed === 0 && still.length === 0,
    drained,
    failed,
    remainingPending: still.length,
    messages,
  };
}
