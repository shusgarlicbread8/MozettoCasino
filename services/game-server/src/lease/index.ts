export type {
  AcquireFail,
  AcquireOk,
  AcquireResult,
  DurableTableEvent,
  LeaseBackend,
  LeaseRecord,
  ReplayResult,
} from "./types.js";

export { MemoryLeaseBackend } from "./memory-store.js";
export { RedisLeaseBackend, connectRedisLeaseBackend } from "./redis-store.js";
export {
  TableActorLeaseManager,
  createLeaseManagerFromEnv,
  getLeaseManager,
  resetLeaseManagerSingleton,
  defaultLeaseWaitMs,
  type LeaseMode,
  type TableActorLeaseManagerOptions,
} from "./manager.js";
export {
  replayDurableEvents,
  recoverActorTip,
  mapHandEventRows,
  type RecoveredActorTip,
} from "./recovery.js";

import { getLeaseManager } from "./manager.js";

/** True when REDIS_URL is configured (multi-replica fencing required). */
export function leaseEnabled(): boolean {
  return Boolean(process.env.REDIS_URL);
}

/** @deprecated Prefer getLeaseManager().manager.acquire */
export async function acquireTableLease(tableId: string): Promise<boolean> {
  const { manager } = await getLeaseManager();
  const lease = await manager.acquire(tableId);
  return lease != null;
}

/** @deprecated Prefer getLeaseManager().manager.renew */
export async function renewTableLease(tableId: string): Promise<boolean> {
  const { manager } = await getLeaseManager();
  const lease = await manager.renew(tableId);
  return lease != null;
}

/** @deprecated Prefer getLeaseManager().manager.release */
export async function releaseTableLease(tableId: string): Promise<void> {
  const { manager } = await getLeaseManager();
  await manager.release(tableId);
}
