/**
 * Compare TS vs Rust differential bundles; emit mismatch report.
 */

const COMPARE_FIELDS = [
  "op",
  "street",
  "button",
  "actingIndex",
  "pot",
  "currentBet",
  "minRaise",
  "lastRaiseComplete",
  "stacks",
  "stateHash",
  "legalActionsHash",
  "legalActions",
  "winners",
  "rake",
  "potLayers",
];

function normHash(h) {
  if (h == null) return null;
  return String(h).toLowerCase();
}

function stable(v) {
  return JSON.stringify(v);
}

/**
 * @returns {{ ok: boolean, report: object }}
 */
export function compareBundles(tsBundle, rustBundle, { mode = "fixtures" } = {}) {
  const mismatches = [];
  const fixtureRows = [];

  const tsMap = new Map(tsBundle.fixtures.map((f) => [f.id, f]));
  const rustMap = new Map(rustBundle.fixtures.map((f) => [f.id, f]));

  const ids = [...new Set([...tsMap.keys(), ...rustMap.keys()])].sort();

  for (const id of ids) {
    const ts = tsMap.get(id);
    const rust = rustMap.get(id);
    if (!ts) {
      mismatches.push({
        id,
        kind: "missing_ts",
        detail: "fixture present in Rust dump only",
      });
      fixtureRows.push({ id, ok: false, snapshotCount: 0, mismatchCount: 1 });
      continue;
    }
    if (!rust) {
      mismatches.push({
        id,
        kind: "missing_rust",
        detail: "fixture present in TS dump only",
      });
      fixtureRows.push({ id, ok: false, snapshotCount: 0, mismatchCount: 1 });
      continue;
    }

    const n = Math.max(ts.snapshots.length, rust.snapshots.length);
    let local = 0;
    for (let i = 0; i < n; i++) {
      const a = ts.snapshots[i];
      const b = rust.snapshots[i];
      if (!a || !b) {
        mismatches.push({
          id,
          stepIndex: i,
          kind: "length",
          detail: `snapshot count TS=${ts.snapshots.length} Rust=${rust.snapshots.length}`,
          ts: a ?? null,
          rust: b ?? null,
        });
        local += 1;
        break;
      }
      for (const field of COMPARE_FIELDS) {
        let av = a[field];
        let bv = b[field];
        if (field === "stateHash" || field === "legalActionsHash") {
          av = normHash(av);
          bv = normHash(bv);
        }
        if (stable(av) !== stable(bv)) {
          mismatches.push({
            id,
            stepIndex: i,
            op: a.op,
            field,
            kind: "field",
            ts: av,
            rust: bv,
          });
          local += 1;
        }
      }
    }
    fixtureRows.push({
      id,
      ok: local === 0,
      snapshotCount: Math.min(ts.snapshots.length, rust.snapshots.length),
      mismatchCount: local,
    });
  }

  const ok = mismatches.length === 0;
  const report = {
    workPacket: "WP-034",
    mode,
    ok,
    summary: {
      fixtureCount: ids.length,
      matched: fixtureRows.filter((r) => r.ok).length,
      mismatched: fixtureRows.filter((r) => !r.ok).length,
      mismatchCount: mismatches.length,
    },
    fixtures: fixtureRows,
    mismatches,
    mismatchReportFormat: {
      description:
        "Each mismatch lists fixture id, stepIndex, field, and ts vs rust values. kind=field|length|missing_ts|missing_rust.",
      unexplainedMeans:
        "Any field mismatch without an entry in docs/WP-034_DIFFERENTIAL_HARNESS.md known divergences.",
    },
  };
  return { ok, report };
}
