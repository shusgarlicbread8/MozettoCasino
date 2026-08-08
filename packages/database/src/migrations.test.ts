/**
 * Migration integrity — static checks that run without a database.
 *
 * These exist because a from-zero migration is only exercised on a fresh
 * environment, which is exactly where you least want to discover a failure.
 * The FK-unsafe-delete check below was written after `033` was found deleting
 * the `sovereign` league while `002` still seeds a table referencing it, which
 * aborts `pnpm db:migrate` on any clean database.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CITIES, atomsToUsdc, buyInBand } from "@mozetto/game-rules";

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

function files(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}
const read = (f: string) => readFileSync(join(MIGRATIONS, f), "utf8");

describe("migration ordering", () => {
  it("is sequentially numbered with no gaps or duplicates", () => {
    const nums = files().map((f) => {
      const m = /^(\d+)_/.exec(f);
      assert.ok(m, `${f} must start with a zero-padded number`);
      return Number(m![1]);
    });
    const sorted = [...nums].sort((a, b) => a - b);
    assert.deepEqual(nums, sorted, "files must sort in numeric order");
    assert.equal(new Set(nums).size, nums.length, "duplicate migration numbers");
    for (let i = 1; i < sorted.length; i++) {
      assert.equal(sorted[i], sorted[i - 1]! + 1, `gap before migration ${sorted[i]}`);
    }
  });
});

describe("migrations are safe to apply from zero", () => {
  /** Tables that other tables point at via a foreign key. */
  const REFERENCED_TABLES = new Set<string>();
  for (const f of files()) {
    for (const m of read(f).matchAll(/references\s+([a-z_]+)\s*\(/gi)) {
      REFERENCED_TABLES.add(m[1]!.toLowerCase());
    }
  }

  it("never deletes from a referenced table without guarding the reference", () => {
    const offenders: string[] = [];
    for (const f of files()) {
      const sql = read(f);
      // Statement-level scan so a guard in one statement cannot excuse another.
      for (const stmt of sql.split(";")) {
        const m = /delete\s+from\s+([a-z_]+)/i.exec(stmt);
        if (!m) continue;
        const target = m[1]!.toLowerCase();
        if (!REFERENCED_TABLES.has(target)) continue;
        // A guarded delete proves it will not trip the foreign key.
        const guarded = /not\s+exists|where[\s\S]*\bin\s*\(\s*select|cascade/i.test(stmt);
        if (!guarded) {
          offenders.push(`${f}: unguarded "delete from ${target}"`);
        }
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `Deleting from a table other tables reference aborts the whole migration:\n${offenders.join("\n")}`,
    );
  });

  it("wraps nothing in an explicit transaction (the runner owns that)", () => {
    // migrate.mjs runs each file inside begin/commit; a nested BEGIN would
    // silently break rollback semantics on failure.
    for (const f of files()) {
      const sql = read(f).toLowerCase();
      assert.ok(!/^\s*begin\s*;/m.test(sql), `${f} must not open its own transaction`);
      assert.ok(!/^\s*commit\s*;/m.test(sql), `${f} must not commit`);
    }
  });

  it("has no destructive schema reset", () => {
    for (const f of files()) {
      const sql = read(f).toLowerCase();
      assert.ok(!/drop\s+schema/.test(sql), `${f} drops a schema`);
      assert.ok(!/drop\s+database/.test(sql), `${f} drops the database`);
      assert.ok(!/truncate\s+/.test(sql), `${f} truncates a table`);
    }
  });
});

describe("the cities migration matches cities.ts", () => {
  const sql = read("033_cities_stake_ladder.sql");

  it("carries the same stakes and buy-in ceiling as the code", () => {
    for (const city of CITIES) {
      const sb = atomsToUsdc(city.smallBlindAtoms).toFixed(2);
      const bb = atomsToUsdc(city.bigBlindAtoms).toFixed(2);
      const maxBuyIn = atomsToUsdc(buyInBand(city).maxAtoms);
      const row = new RegExp(
        `update leagues set small_blind\\s*=\\s*${sb.replace(".", "\\.")},\\s*big_blind\\s*=\\s*${bb.replace(".", "\\.")},\\s*max_buy_in\\s*=\\s*${maxBuyIn}\\b[^;]*where id = '${city.id}'`,
      );
      assert.match(
        sql.replace(/\s+/g, " "),
        new RegExp(row.source.replace(/\\s\*/g, "\\s*")),
        `${city.name} (${city.id}) stakes drifted between cities.ts and migration 033`,
      );
    }
  });

  it("sets each city's min_buy_in to its 40BB floor", () => {
    for (const city of CITIES) {
      const minBuyIn = atomsToUsdc(buyInBand(city).minAtoms);
      assert.match(
        sql,
        new RegExp(`'${city.id}'[^\\n]*?,\\s*${minBuyIn}\\s*,`),
        `${city.name} min_buy_in should be its 40BB floor (${minBuyIn})`,
      );
    }
  });
});
