#!/usr/bin/env node
/**
 * WP-104 — Validate docs/audits/register.yaml integrity.
 *
 * Checks schema enums, id uniqueness, CLOSED evidence rules,
 * and rejects fake external-audit rows without report_ref.
 *
 * Exit 0: register structurally valid.
 * --gate-mainnet: also fail if any Critical/High is not CLOSED
 *   (or ACCEPTED_RISK with signoff — exceptional; still fails gate by default).
 *
 * Does not claim audits completed. Does not invent findings.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const registerPath = join(root, "docs/audits/register.yaml");
const gateMainnet = process.argv.includes("--gate-mainnet");

const text = readFileSync(registerPath, "utf8");

/** @typedef {{
 *  id: string,
 *  title: string,
 *  severity: string,
 *  status: string,
 *  stream: string,
 *  source: string,
 *  owner: string,
 *  description: string,
 *  impact: string,
 *  report_ref: string,
 *  fix_refs: string[],
 *  verification: { verifier: string, date: string, commands: string[], evidence: string },
 *  signoff: { by: string, rationale: string, review_by: string },
 * }} Finding */

/**
 * Minimal YAML subset parser for this register shape.
 * Supports: top-level scalars, string lists, findings list of maps with nested maps/lists,
 * folded scalars (`>`), and quoted strings.
 * @param {string} src
 */
function parseRegister(src) {
  const lines = src.split(/\r?\n/);
  /** @type {Record<string, unknown>} */
  const doc = {
    severities: [],
    statuses: [],
    streams: [],
    sources: [],
    integrity_tooling: [],
    findings: [],
  };

  let i = 0;
  /** @type {string | null} */
  let listKey = null;
  /** @type {Finding | null} */
  let finding = null;
  /** @type {"verification" | "signoff" | null} */
  let nested = null;
  /** @type {"fix_refs" | "commands" | null} */
  let nestedList = null;
  /** @type {string | null} */
  let foldKey = null;
  /** @type {string[]} */
  let foldChunks = [];
  /** @type {Record<string, unknown> | null} */
  let toolingItem = null;

  const flushFold = () => {
    if (!foldKey) return;
    const value = foldChunks.join(" ").replace(/\s+/g, " ").trim();
    assign(foldKey, value);
    foldKey = null;
    foldChunks = [];
  };

  /**
   * @param {string} key
   * @param {unknown} value
   */
  const assign = (key, value) => {
    if (nested === "verification" && finding) {
      if (key === "commands" && Array.isArray(value)) {
        finding.verification.commands = /** @type {string[]} */ (value);
      } else if (key in finding.verification) {
        // @ts-expect-error index
        finding.verification[key] = value;
      }
      return;
    }
    if (nested === "signoff" && finding) {
      if (key in finding.signoff) {
        // @ts-expect-error index
        finding.signoff[key] = value;
      }
      return;
    }
    if (finding) {
      if (key === "fix_refs" && Array.isArray(value)) {
        finding.fix_refs = /** @type {string[]} */ (value);
      } else if (key in finding) {
        // @ts-expect-error index
        finding[key] = value;
      }
      return;
    }
    if (toolingItem && (key === "packet" || key === "doc" || key === "command")) {
      toolingItem[key] = value;
      return;
    }
    doc[key] = value;
  };

  const emptyFinding = () => /** @type {Finding} */ ({
    id: "",
    title: "",
    severity: "",
    status: "",
    stream: "",
    source: "",
    owner: "",
    description: "",
    impact: "",
    report_ref: "",
    fix_refs: [],
    verification: { verifier: "", date: "", commands: [], evidence: "" },
    signoff: { by: "", rationale: "", review_by: "" },
  });

  while (i < lines.length) {
    const raw = lines[i];
    i += 1;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const indent = raw.match(/^ */)?.[0].length ?? 0;

    if (foldKey) {
      if (indent >= 2 && !trimmed.startsWith("- ") && !/^[a-z_]+:/.test(trimmed)) {
        foldChunks.push(trimmed.replace(/^>/, "").trim());
        continue;
      }
      flushFold();
      // re-process this line
      i -= 1;
      continue;
    }

    // Top-level key
    if (indent === 0 && /^[a-z_]+:/.test(trimmed)) {
      nested = null;
      nestedList = null;
      finding = null;
      toolingItem = null;
      const m = trimmed.match(/^([a-z_]+):\s*(.*)$/);
      if (!m) continue;
      const [, key, rest] = m;
      if (
        key === "severities" ||
        key === "statuses" ||
        key === "streams" ||
        key === "sources" ||
        key === "findings" ||
        key === "integrity_tooling"
      ) {
        listKey = key;
        doc[key] = [];
        continue;
      }
      listKey = null;
      if (rest === ">" || rest === "|") {
        foldKey = key;
        foldChunks = [];
        continue;
      }
      doc[key] = unquote(rest);
      continue;
    }

    // List item under top-level string list
    if (
      listKey &&
      indent === 2 &&
      trimmed.startsWith("- ") &&
      (listKey === "severities" ||
        listKey === "statuses" ||
        listKey === "streams" ||
        listKey === "sources")
    ) {
      /** @type {string[]} */ (doc[listKey]).push(unquote(trimmed.slice(2)));
      continue;
    }

    // integrity_tooling item
    if (listKey === "integrity_tooling" && indent === 2 && trimmed.startsWith("- ")) {
      toolingItem = {};
      /** @type {unknown[]} */ (doc.integrity_tooling).push(toolingItem);
      nested = null;
      finding = null;
      const inline = trimmed.slice(2);
      if (inline.includes(":")) {
        const [k, ...rest] = inline.split(":");
        toolingItem[k.trim()] = unquote(rest.join(":").trim());
      }
      continue;
    }
    if (toolingItem && indent >= 4 && /^[a-z_]+:/.test(trimmed)) {
      const m = trimmed.match(/^([a-z_]+):\s*(.*)$/);
      if (m) toolingItem[m[1]] = unquote(m[2]);
      continue;
    }

    // findings item start
    if (listKey === "findings" && indent === 2 && trimmed.startsWith("- ")) {
      finding = emptyFinding();
      /** @type {Finding[]} */ (doc.findings).push(finding);
      nested = null;
      nestedList = null;
      toolingItem = null;
      const inline = trimmed.slice(2);
      if (inline.startsWith("id:")) {
        finding.id = unquote(inline.slice(3).trim());
      }
      continue;
    }

    if (!finding) continue;

    // Nested list under finding or verification
    if (nestedList && indent >= 6 && trimmed.startsWith("- ")) {
      const val = unquote(trimmed.slice(2));
      if (nestedList === "fix_refs") finding.fix_refs.push(val);
      if (nestedList === "commands") finding.verification.commands.push(val);
      continue;
    }

    if (indent === 4 && /^[a-z_]+:/.test(trimmed)) {
      nestedList = null;
      const m = trimmed.match(/^([a-z_]+):\s*(.*)$/);
      if (!m) continue;
      const [, key, rest] = m;
      if (key === "verification") {
        nested = "verification";
        continue;
      }
      if (key === "signoff") {
        nested = "signoff";
        continue;
      }
      if (key === "fix_refs") {
        nested = null;
        nestedList = "fix_refs";
        finding.fix_refs = [];
        continue;
      }
      nested = null;
      if (rest === ">" || rest === "|") {
        foldKey = key;
        foldChunks = [];
        continue;
      }
      assign(key, unquote(rest));
      continue;
    }

    if ((nested === "verification" || nested === "signoff") && indent >= 6 && /^[a-z_]+:/.test(trimmed)) {
      const m = trimmed.match(/^([a-z_]+):\s*(.*)$/);
      if (!m) continue;
      const [, key, rest] = m;
      if (nested === "verification" && key === "commands") {
        nestedList = "commands";
        finding.verification.commands = [];
        continue;
      }
      nestedList = null;
      if (rest === ">" || rest === "|") {
        foldKey = key;
        foldChunks = [];
        continue;
      }
      assign(key, unquote(rest));
      continue;
    }
  }
  flushFold();
  return doc;
}

/** @param {string} s */
function unquote(s) {
  const t = s.trim();
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    return t.slice(1, -1);
  }
  return t;
}

const doc = parseRegister(text);
const severities = /** @type {string[]} */ (doc.severities);
const statuses = /** @type {string[]} */ (doc.statuses);
const streams = /** @type {string[]} */ (doc.streams);
const sources = /** @type {string[]} */ (doc.sources);
const findings = /** @type {Finding[]} */ (doc.findings);

/** @type {string[]} */
const errors = [];
/** @type {string[]} */
const warnings = [];

if (doc.schema_version !== "1" && doc.schema_version !== 1) {
  errors.push(`schema_version must be 1 (got ${JSON.stringify(doc.schema_version)})`);
}

if (!findings.length) {
  errors.push("findings list is empty");
}

const ids = new Set();
for (const f of findings) {
  if (!f.id) {
    errors.push("finding missing id");
    continue;
  }
  if (ids.has(f.id)) errors.push(`duplicate id ${f.id}`);
  ids.add(f.id);

  if (f.status === "TEMPLATE") continue;

  if (!severities.includes(f.severity)) {
    errors.push(`${f.id}: invalid severity ${JSON.stringify(f.severity)}`);
  }
  if (!statuses.includes(f.status)) {
    errors.push(`${f.id}: invalid status ${JSON.stringify(f.status)}`);
  }
  if (!streams.includes(f.stream)) {
    errors.push(`${f.id}: invalid stream ${JSON.stringify(f.stream)}`);
  }
  if (!sources.includes(f.source)) {
    errors.push(`${f.id}: invalid source ${JSON.stringify(f.source)}`);
  }
  if (!f.title) errors.push(`${f.id}: missing title`);
  if (!f.description) errors.push(`${f.id}: missing description`);

  if (f.source === "external-audit" && !f.report_ref) {
    errors.push(
      `${f.id}: source=external-audit requires report_ref (do not invent unpaid audit rows)`,
    );
  }

  if (
    (f.severity === "Critical" || f.severity === "High") &&
    f.source === "wp-104-scaffold-example"
  ) {
    errors.push(`${f.id}: scaffold examples must not be Critical/High`);
  }

  if (f.status === "IN_PROGRESS" && !f.owner) {
    errors.push(`${f.id}: IN_PROGRESS requires owner`);
  }

  if (
    (f.status === "FIXED_PENDING_VERIFY" || f.status === "CLOSED") &&
    (!f.fix_refs || f.fix_refs.length === 0)
  ) {
    errors.push(`${f.id}: ${f.status} requires fix_refs`);
  }

  if (f.status === "CLOSED") {
    if (!f.verification?.verifier) {
      errors.push(`${f.id}: CLOSED requires verification.verifier (independent re-verify)`);
    }
    if (!f.verification?.date) {
      errors.push(`${f.id}: CLOSED requires verification.date`);
    }
    const hasCmd = (f.verification?.commands?.length ?? 0) > 0;
    const hasEv = Boolean(f.verification?.evidence);
    if (!hasCmd && !hasEv) {
      errors.push(`${f.id}: CLOSED requires verification.commands or verification.evidence`);
    }
  }

  if (f.status === "ACCEPTED_RISK" || f.status === "WONT_FIX") {
    if (!f.signoff?.by || !f.signoff?.rationale) {
      errors.push(`${f.id}: ${f.status} requires signoff.by and signoff.rationale`);
    }
  }

  if (f.status === "DEFERRED" && !f.signoff?.rationale && !f.report_ref) {
    warnings.push(`${f.id}: DEFERRED should include signoff.rationale or report_ref`);
  }
}

// Require example closed + at least one template + residual tracking
if (![...ids].some((id) => id.startsWith("MOZ-EX-"))) {
  errors.push("expected at least one MOZ-EX-* example finding");
}
if (![...ids].some((id) => id.startsWith("MOZ-TPL-"))) {
  errors.push("expected MOZ-TPL-* template row");
}
if (![...ids].some((id) => id.startsWith("MOZ-RES-"))) {
  warnings.push("no MOZ-RES-* residual rows (optional but recommended)");
}

const closedExample = findings.find((f) => f.id === "MOZ-EX-001");
if (!closedExample || closedExample.status !== "CLOSED") {
  errors.push("MOZ-EX-001 must exist with status CLOSED (scaffold example)");
}

const openBlocking = findings.filter(
  (f) =>
    (f.severity === "Critical" || f.severity === "High") &&
    f.status !== "CLOSED" &&
    f.status !== "TEMPLATE",
);

console.log("== WP-104 audit findings register check ==");
console.log(`file=${registerPath}`);
console.log(`schema_version=${doc.schema_version}`);
console.log(`findings=${findings.length}`);
console.log(
  `by_status=${JSON.stringify(
    Object.fromEntries(
      [...new Set(findings.map((f) => f.status))].map((s) => [
        s,
        findings.filter((f) => f.status === s).length,
      ]),
    ),
  )}`,
);
console.log(`open_critical_high=${openBlocking.length}`);
if (openBlocking.length) {
  for (const f of openBlocking) {
    console.log(`  BLOCKER ${f.id} severity=${f.severity} status=${f.status}`);
  }
}

for (const w of warnings) console.warn(`WARN: ${w}`);
for (const e of errors) console.error(`FAIL: ${e}`);

if (errors.length) {
  console.error(`result=FAIL errors=${errors.length}`);
  process.exit(1);
}

if (gateMainnet && openBlocking.length) {
  console.error(
    `result=FAIL gate-mainnet: ${openBlocking.length} open Critical/High (Plan 14 readiness)`,
  );
  process.exit(1);
}

console.log("result=PASS");
console.log(
  "note=Scaffold valid. External audits / Stage C findings not claimed complete.",
);
process.exit(0);
