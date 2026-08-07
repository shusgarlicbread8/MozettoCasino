/**
 * Optional PokerKit oracle probe / scenario check (WP-034).
 *
 * PokerKit is a *reference* oracle for curated settlement/hand-eval scenarios in
 * tools/pokerkit-oracle/. It is NOT required for TS↔Rust fixture parity.
 */
import { spawnSync, execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

function tryImportPokerKit(python) {
  const r = spawnSync(python, ["-c", "import pokerkit; print(pokerkit.__version__)"], {
    encoding: "utf8",
  });
  if (r.status === 0) {
    return { ok: true, version: (r.stdout || "").trim(), python };
  }
  return { ok: false, detail: (r.stderr || r.stdout || "").trim() };
}

function findPython(oracleDir) {
  const venvPy = join(oracleDir, ".venv/bin/python");
  if (existsSync(venvPy)) {
    const v = tryImportPokerKit(venvPy);
    if (v.ok) return v;
  }
  for (const py of ["python3", "python"]) {
    try {
      execSync(`${py} --version`, { stdio: "ignore" });
    } catch {
      continue;
    }
    const v = tryImportPokerKit(py);
    if (v.ok) return v;
  }
  return null;
}

/**
 * @param {string} root
 * @param {{ dry?: boolean }} [opts]
 */
export function checkPokerKit(root, opts = {}) {
  const oracleDir = join(root, "tools/pokerkit-oracle");
  const script = join(oracleDir, "run_scenarios.py");
  const expectedPath = join(oracleDir, "expected.json");

  if (!existsSync(script)) {
    return {
      status: "skipped",
      reason: "tools/pokerkit-oracle/run_scenarios.py missing",
    };
  }

  const py = findPython(oracleDir);
  if (!py) {
    return {
      status: "skipped",
      reason:
        "PokerKit not installed (optional). Create tools/pokerkit-oracle/.venv and pip install pokerkit — see tools/pokerkit-oracle/README.md",
    };
  }

  if (opts.dry) {
    return {
      status: "ok",
      reason: `PokerKit ${py.version} via ${py.python}`,
      detail: { version: py.version, python: py.python },
    };
  }

  const run = spawnSync(py.python, [script], {
    encoding: "utf8",
    cwd: oracleDir,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (run.status !== 0) {
    return {
      status: "fail",
      reason: "run_scenarios.py failed",
      detail: (run.stderr || run.stdout || "").slice(0, 2000),
    };
  }

  let live;
  try {
    live = JSON.parse(run.stdout);
  } catch (e) {
    return {
      status: "fail",
      reason: "PokerKit stdout not JSON",
      detail: String(e),
    };
  }

  const expected = JSON.parse(readFileSync(expectedPath, "utf8"));
  const divergences = [];
  const liveMap = Object.fromEntries(
    live.filter((x) => x.name && x.stacks).map((x) => [x.name, x.stacks]),
  );

  for (const [name, want] of Object.entries(expected.pokerkit_live || {})) {
    const got = liveMap[name];
    if (!got) {
      divergences.push({ name, kind: "missing_live", want });
      continue;
    }
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      divergences.push({ name, kind: "stacks", want, got });
    }
  }

  // Hand-eval boolean checks from live run when present
  const handEval = live.find((x) => x.name === "hand_eval" || x.six_beats_wheel != null);
  if (handEval && expected.hand_eval) {
    for (const [k, want] of Object.entries(expected.hand_eval)) {
      if (handEval[k] !== want) {
        divergences.push({ name: "hand_eval", field: k, want, got: handEval[k] });
      }
    }
  }

  if (divergences.length) {
    return {
      status: "fail",
      reason: "PokerKit live results diverge from tools/pokerkit-oracle/expected.json",
      detail: { version: py.version, divergences },
      knownMozettoPolicyGaps: [
        "Mozetto fold-win awards full pot (no uncalled-bet return) — may differ from PokerKit chip-pulling",
        "Mozetto rake is bps/cap room rule — PokerKit scenarios in this oracle run with no Mozetto rake",
        "Full fixture replay through PokerKit is out of scope; oracle covers curated settlement/hand-eval only",
      ],
    };
  }

  return {
    status: "ok",
    reason: `PokerKit ${py.version}: curated scenarios match expected.json`,
    detail: {
      version: py.version,
      python: py.python,
      scenarioCount: live.filter((x) => x.stacks).length,
    },
    knownMozettoPolicyGaps: [
      "Mozetto fold-win awards full pot (no uncalled-bet return) — may differ from PokerKit chip-pulling",
      "Mozetto rake is bps/cap room rule — PokerKit scenarios in this oracle run with no Mozetto rake",
      "Full fixture replay through PokerKit is out of scope; oracle covers curated settlement/hand-eval only",
    ],
  };
}
