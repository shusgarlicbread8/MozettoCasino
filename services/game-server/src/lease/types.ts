/**
 * WP-080 — Table actor lease types (Plan 07 authority model).
 *
 * Lease payload mirrors:
 *   tableId · actorInstanceId · leaseVersion · expiresAt
 */

export type LeaseRecord = {
  tableId: string;
  actorInstanceId: string;
  leaseVersion: number;
  expiresAt: number;
};

export type AcquireOk = {
  ok: true;
  lease: LeaseRecord;
  /** True when this acquire replaced an expired/foreign lease. */
  reclaimed: boolean;
};

export type AcquireFail = {
  ok: false;
  reason: "held_by_other" | "version_mismatch" | "store_unavailable";
  holder?: LeaseRecord;
};

export type AcquireResult = AcquireOk | AcquireFail;

export interface LeaseBackend {
  tryAcquire(
    tableId: string,
    actorInstanceId: string,
    ttlMs: number,
    now: number,
  ): Promise<AcquireResult>;
  renew(
    tableId: string,
    actorInstanceId: string,
    expectedVersion: number,
    ttlMs: number,
    now: number,
  ): Promise<AcquireResult>;
  release(
    tableId: string,
    actorInstanceId: string,
    expectedVersion?: number,
  ): Promise<boolean>;
  get(tableId: string, now: number): Promise<LeaseRecord | null>;
}

export type DurableTableEvent = {
  sequence: number;
  eventType: string;
  eventHash: string;
  prevEventHash: string | null;
  handId?: string | null;
  payload?: Record<string, unknown>;
  timestamp?: string | number;
};

export type ReplayResult = {
  ok: boolean;
  sequence: number;
  prevHash: string | null;
  tipEventHash: string | null;
  eventsReplayed: number;
  issues: string[];
};
