import pg from "pg";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const { Client } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

function sslConfig(connectionString) {
  // Local docker / localhost usually has no TLS. Supabase pooler needs SSL.
  const lower = connectionString.toLowerCase();
  if (
    process.env.DATABASE_SSL === "0" ||
    process.env.DATABASE_SSL === "false" ||
    /[?&]sslmode=disable\b/.test(lower) ||
    /@(localhost|127\.0\.0\.1)(:|\/)/.test(connectionString)
  ) {
    return false;
  }
  if (process.env.DATABASE_SSL === "1" || process.env.DATABASE_SSL === "true") {
    return { rejectUnauthorized: false };
  }
  // Default: enable SSL for remote hosts (Supabase).
  return { rejectUnauthorized: false };
}

async function main() {
  const client = new Client({
    connectionString: url,
    ssl: sslConfig(url),
  });
  await client.connect();

  await client.query(`
    create table if not exists schema_migrations (
      id text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  const dir = join(root, "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

  for (const file of files) {
    const applied = await client.query("select 1 from schema_migrations where id = $1", [file]);
    if (applied.rowCount) {
      console.log(`skip ${file}`);
      continue;
    }
    const body = readFileSync(join(dir, file), "utf8");
    console.log(`apply ${file}...`);
    await client.query("begin");
    try {
      await client.query(body);
      await client.query("insert into schema_migrations (id) values ($1)", [file]);
      await client.query("commit");
      console.log(`ok ${file}`);
    } catch (err) {
      await client.query("rollback");
      throw err;
    }
  }

  await client.end();
  console.log("migrations complete");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
