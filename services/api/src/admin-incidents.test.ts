import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildAutoIncidentSignals } from "./admin-incident-auto.js";
import { auditRowsToCsv } from "./admin-audit-export.js";
import { sevLabelToSeverity, severityToSevLabel } from "./admin-incidents.js";
import { buildConfigMetadataSnapshot } from "./admin-config.js";

describe("admin-incident-auto", () => {
  it("emits solvency + indexer + ai signals on critical", () => {
    const signals = buildAutoIncidentSignals({
      solvencyStatus: "CRITICAL",
      solvencyReasons: ["protocol_insolvent"],
      watchtowerSignal: "verification_failed",
      indexerStatus: "CRITICAL",
      indexerReasons: ["lag_blocks>=200"],
      aiStatus: "CRITICAL",
      aiReasons: ["fallback_rate_high"],
    });
    const keys = signals.map((s) => s.autoSourceKey);
    assert.ok(keys.includes("auto:overview:solvency:critical"));
    assert.ok(keys.includes("auto:overview:watchtower:critical"));
    assert.ok(keys.includes("auto:overview:indexer:critical"));
    assert.ok(keys.includes("auto:overview:ai:critical"));
  });

  it("emits nothing when healthy", () => {
    const signals = buildAutoIncidentSignals({
      solvencyStatus: "HEALTHY",
      solvencyReasons: ["within_policy"],
      watchtowerSignal: "ok",
      indexerStatus: "HEALTHY",
      indexerReasons: ["within_policy"],
      aiStatus: "HEALTHY",
      aiReasons: ["within_policy"],
    });
    assert.equal(signals.length, 0);
  });
});

describe("admin-incidents labels", () => {
  it("maps severity to SEV labels", () => {
    assert.equal(severityToSevLabel("critical"), "SEV0");
    assert.equal(sevLabelToSeverity("SEV1"), "high");
  });
});

describe("admin-audit-export", () => {
  it("serializes CSV with headers", () => {
    const csv = auditRowsToCsv([
      {
        id: "1",
        role: "admin",
        action: "session_ops.pause_after_hand",
        reason: "test",
        actorLabel: "ops",
        entityType: "onchain_session",
        entityId: "sess-1",
        capability: "mutate",
        previousState: null,
        newState: { ok: true },
        requestId: null,
        safeTxId: null,
        createdAt: "2026-08-09T00:00:00.000Z",
      },
    ]);
    assert.match(csv, /^id,createdAt/);
    assert.match(csv, /session_ops.pause_after_hand/);
  });
});

describe("admin-config", () => {
  it("never includes secret values in snapshot", () => {
    const prev = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgres://secret:secret@localhost/db";
    try {
      const snap = buildConfigMetadataSnapshot();
      const dbKey = snap.keys.find((k) => k.key === "DATABASE_URL");
      assert.ok(dbKey?.configured);
      const serialized = JSON.stringify(snap);
      assert.doesNotMatch(serialized, /postgres:\/\/secret/);
      assert.match(serialized, /DATABASE_URL/);
    } finally {
      if (prev === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = prev;
    }
  });
});
