/**
 * WP-081 — Persist-before-broadcast pipeline.
 *
 * BEGIN
 *   durableWrite()   -- insert event (+ snapshot)
 *   appendPending()  -- outbox row status=pending
 * COMMIT
 * publish()
 * markPublished() | markFailed()
 */
import type {
  AppendOutboxInput,
  DurableWriteFn,
  OutboxMessage,
  OutboxStore,
  PersistThenBroadcastResult,
  PublishFn,
} from "./types.js";

export type PersistThenBroadcastOpts = {
  store: OutboxStore;
  /** Must perform all durable inserts; throws → no outbox, no broadcast. */
  durableWrite: DurableWriteFn;
  outbox: AppendOutboxInput;
  publish: PublishFn;
  /**
   * When true (default), run durableWrite then appendPending sequentially.
   * Memory tests use this. Postgres path should pass `atomicPersist` instead
   * so event + outbox share one DB transaction.
   */
  atomicPersist?: () => Promise<OutboxMessage>;
};

/**
 * Core rule: never call `publish` until durable persistence (+ outbox row) succeeded.
 */
export async function persistThenBroadcast(
  opts: PersistThenBroadcastOpts,
): Promise<PersistThenBroadcastResult> {
  let message: OutboxMessage;

  if (opts.atomicPersist) {
    message = await opts.atomicPersist();
  } else {
    await opts.durableWrite();
    message = await opts.store.appendPending(opts.outbox);
  }

  if (message.status === "published") {
    // Idempotent re-entry: already delivered.
    return { message, published: true };
  }

  try {
    await opts.publish(message);
    await opts.store.markPublished(message.id);
    return {
      message: { ...message, status: "published", publishedAtMs: Date.now() },
      published: true,
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    // Keep pending so restart recovery retries; durable event already committed.
    await opts.store.bumpAttempt(message.id, detail).catch(() => null);
    return {
      message: {
        ...message,
        status: "pending",
        attempts: message.attempts + 1,
        lastError: detail,
      },
      published: false,
    };
  }
}

/**
 * Replay undelivered outbox rows (restart recovery).
 * Does not re-insert events — only re-publishes pending WS frames.
 */
export async function drainPendingOutbox(opts: {
  store: OutboxStore;
  publish: PublishFn;
  tableId?: string;
  sessionId?: string;
  limit?: number;
}): Promise<{ drained: number; failed: number; messages: OutboxMessage[] }> {
  const pending = await opts.store.listPending({
    tableId: opts.tableId,
    sessionId: opts.sessionId,
    limit: opts.limit,
  });
  let drained = 0;
  let failed = 0;
  const messages: OutboxMessage[] = [];

  for (const msg of pending) {
    try {
      await opts.publish(msg);
      await opts.store.markPublished(msg.id);
      drained += 1;
      messages.push({ ...msg, status: "published", publishedAtMs: Date.now() });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      await opts.store.bumpAttempt(msg.id, detail).catch(() => null);
      failed += 1;
      messages.push({
        ...msg,
        status: "pending",
        attempts: msg.attempts + 1,
        lastError: detail,
      });
    }
  }

  return { drained, failed, messages };
}

/** Assert helper for tests: publish must not run if durableWrite throws. */
export async function assertPersistBeforeBroadcastInvariant(
  opts: PersistThenBroadcastOpts,
): Promise<{ broadcastCalled: boolean; error: unknown }> {
  let broadcastCalled = false;
  try {
    await persistThenBroadcast({
      ...opts,
      publish: async (msg) => {
        broadcastCalled = true;
        await opts.publish(msg);
      },
    });
    return { broadcastCalled, error: null };
  } catch (error) {
    return { broadcastCalled, error };
  }
}
