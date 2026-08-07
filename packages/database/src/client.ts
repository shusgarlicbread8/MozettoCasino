import pg from "pg";

// Runtime uses the `pg` package; keep typings intentionally loose for the monorepo TS graph.
const { Pool } = pg as any;

let pool: any = null;

function sslForUrl(url: string): false | { rejectUnauthorized: false } {
  const lower = url.toLowerCase();
  if (
    process.env.DATABASE_SSL === "0" ||
    process.env.DATABASE_SSL === "false" ||
    /[?&]sslmode=disable\b/.test(lower) ||
    /@(localhost|127\.0\.0\.1)(:|\/)/.test(url)
  ) {
    return false;
  }
  return { rejectUnauthorized: false };
}

export function getPool(): any {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL required");
    pool = new Pool({
      connectionString: url,
      ssl: sslForUrl(url),
      max: 10,
    });
    // Idle pooler disconnects must not crash the process.
    pool.on("error", (err: Error) => {
      console.error("[pg] idle client error", err.message);
    });
  }
  return pool;
}

export async function query<T = any>(text: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }> {
  return getPool().query(text, params);
}

/** Client-bound query (same shape as pool.query). */
export type DbClient = {
  query: <T = any>(text: string, params?: unknown[]) => Promise<{ rows: T[]; rowCount: number | null }>;
};

/**
 * Run work inside a single Postgres transaction.
 * Rollback on throw; commit on success. Nested callers should use the provided client.
 */
export async function withTransaction<T>(fn: (client: DbClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (err) {
    try {
      await client.query("rollback");
    } catch {
      /* ignore rollback errors */
    }
    throw err;
  } finally {
    client.release();
  }
}
