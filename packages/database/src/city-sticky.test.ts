import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("city-scoped sticky matchmaking", () => {
  it("on-chain sticky query filters by league_id when a city is requested", () => {
    const src = readFileSync(join(root, "src/onchain-match.ts"), "utf8");
    assert.match(src, /\$6::text is null or t\.league_id = \$6/);
    assert.match(src, /cityId\?: string/);
  });

  it("demo find-match reuse requires the same city", () => {
    const src = readFileSync(join(root, "src/matchmaking.ts"), "utf8");
    assert.match(src, /and t\.league_id = \$6/);
    assert.match(src, /already_seated_elsewhere/);
  });

  it("migration 035 deactivates stake-mismatched live tables", () => {
    const sql = readFileSync(
      join(root, "migrations/035_align_city_table_stakes.sql"),
      "utf8",
    );
    assert.match(sql, /set is_active = false/);
    assert.match(sql, /league_id = 'casual'/);
    assert.match(sql, /big_blind is distinct from 0\.50/);
  });
});
