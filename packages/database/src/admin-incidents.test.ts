import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isIncidentSeverity, isIncidentStatus } from "./admin-incidents.js";

describe("admin-incidents types", () => {
  it("validates incident status", () => {
    assert.ok(isIncidentStatus("open"));
    assert.ok(isIncidentStatus("resolved"));
    assert.equal(isIncidentStatus("OPEN"), false);
  });

  it("validates incident severity", () => {
    assert.ok(isIncidentSeverity("critical"));
    assert.ok(isIncidentSeverity("info"));
    assert.equal(isIncidentSeverity("SEV0"), false);
  });
});
