/**
 * Optional Redis table lease — prevents two game-server replicas from owning the same table.
 * When REDIS_URL is unset, all lease calls are no-ops (single-replica mode).
 */
import { randomUUID } from "node:crypto";

const REDIS_URL = process.env.REDIS_URL;
const LEASE_TTL_SEC = Number(process.env.TABLE_LEASE_TTL_SEC ?? 30);
const LEASE_PREFIX = "mozetto:table-lease:";

type RedisClient = {
  set(key: string, value: string, exMode: "EX", ttl: number, nxMode: "NX"): Promise<string | null>;
  get(key: string): Promise<string | null>;
  eval(script: string, numKeys: number, ...args: string[]): Promise<unknown>;
  quit(): Promise<void>;
};

let redis: RedisClient | null | undefined;
const holderId = randomUUID();

async function getRedis(): Promise<RedisClient | null> {
  if (redis !== undefined) return redis;
  if (!REDIS_URL) {
    redis = null;
    return null;
  }
  try {
    const { default: Redis } = await import("ioredis");
    redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: true }) as unknown as RedisClient;
    await (redis as { connect?: () => Promise<void> }).connect?.();
    return redis;
  } catch {
    redis = null;
    return null;
  }
}

/** Try to acquire lease for tableId. Returns true if this replica owns the table. */
export async function acquireTableLease(tableId: string): Promise<boolean> {
  const client = await getRedis();
  if (!client) return true;
  const key = `${LEASE_PREFIX}${tableId}`;
  const result = await client.set(key, holderId, "EX", LEASE_TTL_SEC, "NX");
  if (result === "OK") return true;
  const current = await client.get(key);
  return current === holderId;
}

/** Renew lease if we still hold it. */
export async function renewTableLease(tableId: string): Promise<boolean> {
  const client = await getRedis();
  if (!client) return true;
  const key = `${LEASE_PREFIX}${tableId}`;
  const script = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("setex", KEYS[1], ARGV[2], ARGV[1])
    else
      return nil
    end
  `;
  const result = await client.eval(script, 1, key, holderId, String(LEASE_TTL_SEC));
  return result === "OK";
}

/** Release lease on shutdown or table unload. */
export async function releaseTableLease(tableId: string): Promise<void> {
  const client = await getRedis();
  if (!client) return;
  const key = `${LEASE_PREFIX}${tableId}`;
  const script = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("del", KEYS[1])
    else
      return 0
    end
  `;
  await client.eval(script, 1, key, holderId).catch(() => null);
}

export function leaseEnabled(): boolean {
  return Boolean(REDIS_URL);
}
