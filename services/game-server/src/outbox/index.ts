export type {
  AppendOutboxInput,
  DurableWriteFn,
  OutboxMessage,
  OutboxStatus,
  OutboxStore,
  OutboxVisibility,
  PersistThenBroadcastResult,
  PublishFn,
  SchemaKind,
} from "./types.js";

export { MemoryOutboxStore } from "./memory-store.js";
export { PostgresOutboxStore } from "./postgres-store.js";
export {
  persistThenBroadcast,
  drainPendingOutbox,
  assertPersistBeforeBroadcastInvariant,
} from "./pipeline.js";
export { recoverUndeliveredOutbox, type OutboxRecoveryResult } from "./recovery.js";
export {
  preferredSchemaKind,
  mapEventTypeCode,
  canUsePokerEventV1,
  encodePokerEventV1PublicHash,
  encodeSinglePokerEventV1,
  sessionIdToHex,
} from "./schema.js";

import { MemoryOutboxStore } from "./memory-store.js";
import { PostgresOutboxStore } from "./postgres-store.js";
import type { OutboxStore } from "./types.js";

let singleton: OutboxStore | null = null;

/**
 * Process-wide outbox store.
 * - OUTBOX_STORE=memory → in-process (tests / no DB)
 * - else → Postgres `event_persistence_outbox`
 */
export function getOutboxStore(env: NodeJS.ProcessEnv = process.env): OutboxStore {
  if (singleton) return singleton;
  if ((env.OUTBOX_STORE ?? "").toLowerCase() === "memory") {
    singleton = new MemoryOutboxStore();
  } else {
    singleton = new PostgresOutboxStore();
  }
  return singleton;
}

/** Test helper. */
export function resetOutboxStoreSingleton(): void {
  singleton = null;
}

export function setOutboxStoreForTests(store: OutboxStore): void {
  singleton = store;
}
