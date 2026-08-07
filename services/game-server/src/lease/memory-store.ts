/**
 * In-process lease backend for tests and single-replica mode.
 * Two managers sharing one MemoryLeaseBackend correctly contend.
 */
import type { AcquireResult, LeaseBackend, LeaseRecord } from "./types.js";

export class MemoryLeaseBackend implements LeaseBackend {
  private readonly leases = new Map<string, LeaseRecord>();

  /** Test helper: force-expire a lease without deleting the key. */
  expire(tableId: string, now: number): void {
    const cur = this.leases.get(tableId);
    if (cur) this.leases.set(tableId, { ...cur, expiresAt: now - 1 });
  }

  /** Test helper: inspect raw record (may be expired). */
  peek(tableId: string): LeaseRecord | undefined {
    return this.leases.get(tableId);
  }

  clear(): void {
    this.leases.clear();
  }

  async get(tableId: string, now: number): Promise<LeaseRecord | null> {
    const cur = this.leases.get(tableId);
    if (!cur) return null;
    if (cur.expiresAt <= now) {
      this.leases.delete(tableId);
      return null;
    }
    return { ...cur };
  }

  async tryAcquire(
    tableId: string,
    actorInstanceId: string,
    ttlMs: number,
    now: number,
  ): Promise<AcquireResult> {
    const cur = this.leases.get(tableId);
    if (cur && cur.expiresAt > now) {
      if (cur.actorInstanceId === actorInstanceId) {
        const lease: LeaseRecord = {
          tableId,
          actorInstanceId,
          leaseVersion: cur.leaseVersion + 1,
          expiresAt: now + ttlMs,
        };
        this.leases.set(tableId, lease);
        return { ok: true, lease, reclaimed: false };
      }
      return { ok: false, reason: "held_by_other", holder: { ...cur } };
    }
    const nextVersion = cur ? cur.leaseVersion + 1 : 1;
    const lease: LeaseRecord = {
      tableId,
      actorInstanceId,
      leaseVersion: nextVersion,
      expiresAt: now + ttlMs,
    };
    this.leases.set(tableId, lease);
    return { ok: true, lease, reclaimed: Boolean(cur) };
  }

  async renew(
    tableId: string,
    actorInstanceId: string,
    expectedVersion: number,
    ttlMs: number,
    now: number,
  ): Promise<AcquireResult> {
    const cur = this.leases.get(tableId);
    if (!cur || cur.expiresAt <= now) {
      return { ok: false, reason: "version_mismatch" };
    }
    if (cur.actorInstanceId !== actorInstanceId || cur.leaseVersion !== expectedVersion) {
      return {
        ok: false,
        reason: cur.actorInstanceId !== actorInstanceId ? "held_by_other" : "version_mismatch",
        holder: { ...cur },
      };
    }
    const lease: LeaseRecord = {
      tableId,
      actorInstanceId,
      leaseVersion: cur.leaseVersion + 1,
      expiresAt: now + ttlMs,
    };
    this.leases.set(tableId, lease);
    return { ok: true, lease, reclaimed: false };
  }

  async release(
    tableId: string,
    actorInstanceId: string,
    expectedVersion?: number,
  ): Promise<boolean> {
    const cur = this.leases.get(tableId);
    if (!cur) return false;
    if (cur.actorInstanceId !== actorInstanceId) return false;
    if (expectedVersion != null && cur.leaseVersion !== expectedVersion) return false;
    this.leases.delete(tableId);
    return true;
  }
}
