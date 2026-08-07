/**
 * WP-080 — Table actor lease manager.
 *
 * Single-writer fencing: acquire (or wait for expiry), renew with version bump,
 * release, heartbeat. Refuse action when lease certainty is lost.
 */
import { randomUUID } from "node:crypto";
import { MemoryLeaseBackend } from "./memory-store.js";
import { connectRedisLeaseBackend } from "./redis-store.js";
import type { LeaseBackend, LeaseRecord } from "./types.js";

export type TableActorLeaseManagerOptions = {
  backend: LeaseBackend;
  actorInstanceId?: string;
  ttlMs?: number;
  renewIntervalMs?: number;
  waitPollMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

export class TableActorLeaseManager {
  readonly actorInstanceId: string;
  readonly backend: LeaseBackend;
  readonly ttlMs: number;
  readonly renewIntervalMs: number;
  readonly waitPollMs: number;

  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly held = new Map<string, LeaseRecord>();
  private readonly heartbeats = new Map<string, ReturnType<typeof setInterval>>();

  constructor(opts: TableActorLeaseManagerOptions) {
    this.backend = opts.backend;
    this.actorInstanceId = opts.actorInstanceId ?? randomUUID();
    this.ttlMs = opts.ttlMs ?? 30_000;
    this.renewIntervalMs = opts.renewIntervalMs ?? Math.max(1_000, Math.floor(this.ttlMs / 3));
    this.waitPollMs = opts.waitPollMs ?? 50;
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  getHeld(tableId: string): LeaseRecord | null {
    return this.held.get(tableId) ?? null;
  }

  /** Throws if this instance does not hold a live lease (split-brain guard). */
  assertHeld(tableId: string): LeaseRecord {
    const lease = this.held.get(tableId);
    if (!lease) {
      throw new Error("table_lease_not_held");
    }
    if (lease.expiresAt <= this.now()) {
      this.held.delete(tableId);
      throw new Error("table_lease_expired");
    }
    return lease;
  }

  /**
   * Acquire immediately, or wait until waitMs for the current lease to expire.
   * Returns null if still held by another actor after waiting.
   */
  async acquire(
    tableId: string,
    opts?: { waitMs?: number },
  ): Promise<LeaseRecord | null> {
    const waitMs = opts?.waitMs ?? 0;
    const deadline = this.now() + waitMs;

    for (;;) {
      const result = await this.backend.tryAcquire(
        tableId,
        this.actorInstanceId,
        this.ttlMs,
        this.now(),
      );
      if (result.ok === true) {
        this.held.set(tableId, result.lease);
        return result.lease;
      }
      const fail = result;
      if (fail.reason === "store_unavailable") {
        throw new Error("table_lease_store_unavailable");
      }
      if (this.now() >= deadline) {
        return null;
      }
      const holderExp = fail.holder?.expiresAt;
      const sleepFor = holderExp
        ? Math.min(this.waitPollMs, Math.max(1, holderExp - this.now() + 1))
        : this.waitPollMs;
      await this.sleep(Math.min(sleepFor, Math.max(1, deadline - this.now())));
    }
  }

  async renew(tableId: string): Promise<LeaseRecord | null> {
    const cur = this.held.get(tableId);
    if (!cur) return null;
    const result = await this.backend.renew(
      tableId,
      this.actorInstanceId,
      cur.leaseVersion,
      this.ttlMs,
      this.now(),
    );
    if (!result.ok) {
      this.held.delete(tableId);
      return null;
    }
    this.held.set(tableId, result.lease);
    return result.lease;
  }

  async release(tableId: string): Promise<void> {
    this.stopHeartbeat(tableId);
    const cur = this.held.get(tableId);
    if (!cur) return;
    await this.backend.release(tableId, this.actorInstanceId, cur.leaseVersion).catch(() => false);
    this.held.delete(tableId);
  }

  /**
   * Periodic renew. Calls onLost once if renew fails (lease stolen/expired).
   */
  startHeartbeat(tableId: string, onLost?: (tableId: string) => void): void {
    this.stopHeartbeat(tableId);
    const timer = setInterval(() => {
      void this.renew(tableId).then((lease) => {
        if (!lease) {
          this.stopHeartbeat(tableId);
          onLost?.(tableId);
        }
      });
    }, this.renewIntervalMs);
    // Allow process exit in tests without open handles.
    timer.unref?.();
    this.heartbeats.set(tableId, timer);
  }

  stopHeartbeat(tableId: string): void {
    const t = this.heartbeats.get(tableId);
    if (t) {
      clearInterval(t);
      this.heartbeats.delete(tableId);
    }
  }

  async releaseAll(): Promise<void> {
    const ids = [...this.held.keys()];
    await Promise.all(ids.map((id) => this.release(id)));
  }
}

export type LeaseMode = "redis" | "memory" | "disabled";

let singleton: TableActorLeaseManager | null = null;
let singletonMode: LeaseMode = "disabled";

/**
 * Process-wide manager.
 * - REDIS_URL → Redis backend (multi-replica)
 * - else → Memory backend (single process; tests inject their own)
 *
 * Env:
 *   TABLE_LEASE_TTL_SEC (default 30)
 *   TABLE_LEASE_WAIT_MS (default = ttl)
 *   TABLE_LEASE_ACTOR_ID (optional stable instance id)
 */
export async function createLeaseManagerFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ manager: TableActorLeaseManager; mode: LeaseMode }> {
  const ttlSec = Number(env.TABLE_LEASE_TTL_SEC ?? 30);
  const ttlMs = Math.max(1_000, Math.floor(ttlSec * 1000));
  const actorInstanceId = env.TABLE_LEASE_ACTOR_ID || randomUUID();

  if (env.REDIS_URL) {
    const redis = await connectRedisLeaseBackend(env.REDIS_URL);
    if (redis) {
      return {
        manager: new TableActorLeaseManager({
          backend: redis,
          actorInstanceId,
          ttlMs,
        }),
        mode: "redis",
      };
    }
    // Redis configured but unreachable — refuse silent dual-writer mode.
    throw new Error("table_lease_redis_unavailable");
  }

  return {
    manager: new TableActorLeaseManager({
      backend: new MemoryLeaseBackend(),
      actorInstanceId,
      ttlMs,
    }),
    mode: "memory",
  };
}

/** Lazy singleton for game-server index. */
export async function getLeaseManager(): Promise<{
  manager: TableActorLeaseManager;
  mode: LeaseMode;
}> {
  if (singleton) return { manager: singleton, mode: singletonMode };
  const created = await createLeaseManagerFromEnv();
  singleton = created.manager;
  singletonMode = created.mode;
  return created;
}

/** Test helper — reset singleton between suites. */
export function resetLeaseManagerSingleton(): void {
  singleton = null;
  singletonMode = "disabled";
}

export function defaultLeaseWaitMs(ttlMs: number, env: NodeJS.ProcessEnv = process.env): number {
  if (env.TABLE_LEASE_WAIT_MS != null && env.TABLE_LEASE_WAIT_MS !== "") {
    return Math.max(0, Number(env.TABLE_LEASE_WAIT_MS));
  }
  return ttlMs;
}
