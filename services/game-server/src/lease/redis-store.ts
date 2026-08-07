/**
 * Redis lease backend — atomic acquire / renew / release via Lua.
 * Value JSON: { actorInstanceId, leaseVersion, expiresAt }
 * Logical expiry uses expiresAt; Redis EX is a safety net.
 */
import type { AcquireResult, LeaseBackend, LeaseRecord } from "./types.js";

const LEASE_PREFIX = "mozetto:table-lease:v2:";

type RedisClient = {
  eval(script: string, numKeys: number, ...args: string[]): Promise<unknown>;
  get(key: string): Promise<string | null>;
  quit(): Promise<void>;
};

type Stored = {
  actorInstanceId: string;
  leaseVersion: number;
  expiresAt: number;
};

function keyFor(tableId: string): string {
  return `${LEASE_PREFIX}${tableId}`;
}

function parseStored(raw: string | null): Stored | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Stored;
    if (
      typeof v.actorInstanceId !== "string" ||
      typeof v.leaseVersion !== "number" ||
      typeof v.expiresAt !== "number"
    ) {
      return null;
    }
    return v;
  } catch {
    return null;
  }
}

function toRecord(tableId: string, s: Stored): LeaseRecord {
  return {
    tableId,
    actorInstanceId: s.actorInstanceId,
    leaseVersion: s.leaseVersion,
    expiresAt: s.expiresAt,
  };
}

/**
 * ARGV: actor, ttlMs, nowMs
 * Returns: ok|held, version, actorOrEmpty, reclaimed(0|1), expiresAt
 */
const ACQUIRE_LUA = `
local cur = redis.call("GET", KEYS[1])
local actor = ARGV[1]
local ttlMs = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local ttlSec = math.max(1, math.ceil(ttlMs / 1000))
if cur then
  local obj = cjson.decode(cur)
  if tonumber(obj["expiresAt"]) > now then
    if obj["actorInstanceId"] == actor then
      local next = tonumber(obj["leaseVersion"]) + 1
      local exp = now + ttlMs
      local payload = cjson.encode({ actorInstanceId = actor, leaseVersion = next, expiresAt = exp })
      redis.call("SET", KEYS[1], payload, "EX", ttlSec)
      return { "ok", tostring(next), actor, "0", tostring(exp) }
    end
    return { "held", tostring(obj["leaseVersion"]), obj["actorInstanceId"], "0", tostring(obj["expiresAt"]) }
  end
  local next = tonumber(obj["leaseVersion"]) + 1
  local exp = now + ttlMs
  local payload = cjson.encode({ actorInstanceId = actor, leaseVersion = next, expiresAt = exp })
  redis.call("SET", KEYS[1], payload, "EX", ttlSec)
  return { "ok", tostring(next), actor, "1", tostring(exp) }
end
local exp = now + ttlMs
local payload = cjson.encode({ actorInstanceId = actor, leaseVersion = 1, expiresAt = exp })
redis.call("SET", KEYS[1], payload, "EX", ttlSec)
return { "ok", "1", actor, "0", tostring(exp) }
`;

/** ARGV: actor, expectedVersion, ttlMs, nowMs */
const RENEW_LUA = `
local cur = redis.call("GET", KEYS[1])
if not cur then return { "miss" } end
local obj = cjson.decode(cur)
local now = tonumber(ARGV[4])
if tonumber(obj["expiresAt"]) <= now then return { "miss" } end
if obj["actorInstanceId"] ~= ARGV[1] then
  return { "held", tostring(obj["leaseVersion"]), obj["actorInstanceId"], tostring(obj["expiresAt"]) }
end
if tonumber(obj["leaseVersion"]) ~= tonumber(ARGV[2]) then
  return { "ver", tostring(obj["leaseVersion"]), obj["actorInstanceId"], tostring(obj["expiresAt"]) }
end
local next = tonumber(obj["leaseVersion"]) + 1
local ttlMs = tonumber(ARGV[3])
local ttlSec = math.max(1, math.ceil(ttlMs / 1000))
local exp = now + ttlMs
local payload = cjson.encode({ actorInstanceId = ARGV[1], leaseVersion = next, expiresAt = exp })
redis.call("SET", KEYS[1], payload, "EX", ttlSec)
return { "ok", tostring(next), ARGV[1], tostring(exp) }
`;

const RELEASE_LUA = `
local cur = redis.call("GET", KEYS[1])
if not cur then return 0 end
local obj = cjson.decode(cur)
if obj["actorInstanceId"] ~= ARGV[1] then return 0 end
if ARGV[2] ~= "" and tonumber(obj["leaseVersion"]) ~= tonumber(ARGV[2]) then return 0 end
return redis.call("DEL", KEYS[1])
`;

export class RedisLeaseBackend implements LeaseBackend {
  constructor(private readonly client: RedisClient) {}

  async get(tableId: string, now: number): Promise<LeaseRecord | null> {
    const raw = await this.client.get(keyFor(tableId));
    const stored = parseStored(raw);
    if (!stored || stored.expiresAt <= now) return null;
    return toRecord(tableId, stored);
  }

  async tryAcquire(
    tableId: string,
    actorInstanceId: string,
    ttlMs: number,
    now: number,
  ): Promise<AcquireResult> {
    const result = (await this.client.eval(
      ACQUIRE_LUA,
      1,
      keyFor(tableId),
      actorInstanceId,
      String(ttlMs),
      String(now),
    )) as string[];
    if (!result || result[0] === "held") {
      return {
        ok: false,
        reason: "held_by_other",
        holder: result
          ? {
              tableId,
              actorInstanceId: String(result[2]),
              leaseVersion: Number(result[1]),
              expiresAt: Number(result[4]),
            }
          : undefined,
      };
    }
    return {
      ok: true,
      lease: {
        tableId,
        actorInstanceId: String(result[2]),
        leaseVersion: Number(result[1]),
        expiresAt: Number(result[4]),
      },
      reclaimed: result[3] === "1",
    };
  }

  async renew(
    tableId: string,
    actorInstanceId: string,
    expectedVersion: number,
    ttlMs: number,
    now: number,
  ): Promise<AcquireResult> {
    const result = (await this.client.eval(
      RENEW_LUA,
      1,
      keyFor(tableId),
      actorInstanceId,
      String(expectedVersion),
      String(ttlMs),
      String(now),
    )) as string[];
    if (!result || result[0] === "miss") {
      return { ok: false, reason: "version_mismatch" };
    }
    if (result[0] === "held") {
      return {
        ok: false,
        reason: "held_by_other",
        holder: {
          tableId,
          actorInstanceId: String(result[2]),
          leaseVersion: Number(result[1]),
          expiresAt: Number(result[3]),
        },
      };
    }
    if (result[0] === "ver") {
      return {
        ok: false,
        reason: "version_mismatch",
        holder: {
          tableId,
          actorInstanceId: String(result[2]),
          leaseVersion: Number(result[1]),
          expiresAt: Number(result[3]),
        },
      };
    }
    return {
      ok: true,
      lease: {
        tableId,
        actorInstanceId: String(result[2]),
        leaseVersion: Number(result[1]),
        expiresAt: Number(result[3]),
      },
      reclaimed: false,
    };
  }

  async release(
    tableId: string,
    actorInstanceId: string,
    expectedVersion?: number,
  ): Promise<boolean> {
    const result = await this.client.eval(
      RELEASE_LUA,
      1,
      keyFor(tableId),
      actorInstanceId,
      expectedVersion != null ? String(expectedVersion) : "",
    );
    return Number(result) === 1;
  }
}

/** Connect ioredis when REDIS_URL is set; null on failure. */
export async function connectRedisLeaseBackend(
  redisUrl: string,
): Promise<RedisLeaseBackend | null> {
  try {
    const { default: Redis } = await import("ioredis");
    const client = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
    }) as unknown as RedisClient & { connect?: () => Promise<void> };
    await client.connect?.();
    return new RedisLeaseBackend(client);
  } catch {
    return null;
  }
}
