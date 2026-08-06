import pg from "pg";

// Runtime uses the `pg` package; keep typings intentionally loose for the monorepo TS graph.
const { Pool } = pg as any;

let pool: any = null;

export function getPool(): any {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL required");
    pool = new Pool({
      connectionString: url,
      ssl: { rejectUnauthorized: false },
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
