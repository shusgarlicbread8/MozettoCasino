import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const file = process.argv[2];
if (!file) {
  console.error("Usage: node apply-migration.mjs <file.sql>");
  process.exit(1);
}

const sql = fs.readFileSync(path.resolve(file), "utf8");
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL required");
  process.exit(1);
}

function sslConfig(connectionString) {
  const lower = connectionString.toLowerCase();
  if (
    process.env.DATABASE_SSL === "0" ||
    process.env.DATABASE_SSL === "false" ||
    /[?&]sslmode=disable\b/.test(lower) ||
    /@(localhost|127\.0\.0\.1)(:|\/)/.test(connectionString)
  ) {
    return false;
  }
  return { rejectUnauthorized: false };
}

const client = new pg.Client({ connectionString: url, ssl: sslConfig(url) });
await client.connect();
try {
  await client.query(sql);
  console.log("Applied", file);
} finally {
  await client.end();
}
