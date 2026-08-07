"use client";

import { useEffect, useState } from "react";

type Engine = "wasm" | "ts" | null;

type Report = {
  ok: boolean;
  engine: Engine;
  id?: string;
  finalStacks?: number[] | null;
  finalStateHash?: string | null;
  error?: string | null;
  verifierBuildId?: string | null;
  note?: string;
};

declare global {
  interface Window {
    wasm_bindgen?: (module?: unknown) => Promise<void>;
  }
}

async function tryLoadWasm(): Promise<{
  verify_fixture: (json: string) => string;
  verifier_build_id: () => string;
  engine_build_id: () => string;
} | null> {
  try {
    const modUrl = "/poker-wasm/poker_wasm.js";
    const probe = await fetch(modUrl, { method: "HEAD" });
    if (!probe.ok) return null;
    // Dynamic import of wasm-bindgen web target glue
    const wasm = (await import(/* webpackIgnore: true */ modUrl)) as {
      default?: (input?: unknown) => Promise<unknown>;
      verify_fixture: (json: string) => string;
      verifier_build_id: () => string;
      engine_build_id: () => string;
      initSync?: unknown;
    };
    if (typeof wasm.default === "function") {
      await wasm.default();
    }
    if (typeof wasm.verify_fixture !== "function") return null;
    return wasm;
  } catch {
    return null;
  }
}

async function verifyViaTsApi(fixtureJson: string): Promise<Report> {
  const res = await fetch("/api/verify/fixture", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fixture: JSON.parse(fixtureJson) }),
  });
  const body = await res.json();
  if (!res.ok) {
    return {
      ok: false,
      engine: "ts",
      error: body.error ?? `HTTP ${res.status}`,
      note: body.note,
    };
  }
  return {
    ok: Boolean(body.ok),
    engine: "ts",
    id: body.id,
    finalStacks: body.finalStacks,
    finalStateHash: body.finalStateHash,
    error: body.error,
    note: body.note ?? "Verified with TypeScript @mozetto/game-rules (WP-030 parity).",
  };
}

export function WasmFixturePanel() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [wasmReady, setWasmReady] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const sample = await fetch("/verify/fixtures/hu_02_sb_folds_to_bb.json")
        .then((r) => (r.ok ? r.text() : ""))
        .catch(() => "");
      if (!cancelled && sample) setText(sample);
      const wasm = await tryLoadWasm();
      if (!cancelled) setWasmReady(Boolean(wasm));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function run(prefer: "wasm" | "ts" | "auto") {
    setBusy(true);
    setReport(null);
    try {
      JSON.parse(text);
      if (prefer === "ts") {
        setReport(await verifyViaTsApi(text));
        return;
      }
      const wasm = prefer === "wasm" || prefer === "auto" ? await tryLoadWasm() : null;
      if (wasm) {
        const raw = wasm.verify_fixture(text);
        const parsed = JSON.parse(raw) as {
          ok: boolean;
          id?: string;
          finalStacks?: number[];
          finalStateHash?: string;
          error?: string;
        };
        setReport({
          ok: parsed.ok,
          engine: "wasm",
          id: parsed.id,
          finalStacks: parsed.finalStacks,
          finalStateHash: parsed.finalStateHash,
          error: parsed.error,
          verifierBuildId: wasm.verifier_build_id(),
          note: `WASM engine ${wasm.engine_build_id()}`,
        });
        return;
      }
      setReport(await verifyViaTsApi(text));
    } catch (e) {
      setReport({
        ok: false,
        engine: null,
        error: e instanceof Error ? e.message : "verify failed",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-[13px] leading-relaxed text-[#8A8A8A]">
        Replay a WP-030 fixture locally. Prefers browser WASM when{" "}
        <code className="text-[#6A6A6A]">/poker-wasm/</code> is published (
        <code className="text-[#6A6A6A]">pnpm sync:poker-wasm-web</code>); otherwise uses the
        TypeScript engine API (same freeze vectors).
      </p>
      <div className="font-mono text-[11px] text-[#5A5A5A]">
        WASM asset: {wasmReady == null ? "…" : wasmReady ? "available" : "not published — using TS fallback"}
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        rows={12}
        className="w-full rounded-lg border border-white/[0.1] bg-[#0A0A0A] px-3 py-2 font-mono text-[11.5px] text-[#cfcfcf] outline-none focus:border-[#00E676]/40"
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || !text.trim()}
          onClick={() => run("auto")}
          className="rounded-lg bg-[#00E676] px-3.5 py-2 text-sm font-medium text-[#04140c] disabled:opacity-40"
        >
          {busy ? "Verifying…" : "Verify fixture"}
        </button>
        <button
          type="button"
          disabled={busy || !text.trim()}
          onClick={() => run("ts")}
          className="rounded-lg border border-white/[0.12] px-3.5 py-2 text-sm text-[#9A9A9A] disabled:opacity-40"
        >
          Force TS engine
        </button>
      </div>
      {report ? (
        <div
          className={`rounded-lg border px-3 py-3 text-[13px] ${
            report.ok
              ? "border-emerald-800/50 bg-emerald-900/20 text-emerald-300"
              : "border-red-800/50 bg-red-900/20 text-red-300"
          }`}
        >
          <div className="font-medium">
            {report.ok ? "PASS" : "FAIL"} · engine {report.engine ?? "—"}
          </div>
          {report.id ? <div className="mt-1 font-mono text-[12px]">id {report.id}</div> : null}
          {report.finalStateHash ? (
            <div className="mt-1 break-all font-mono text-[11px] opacity-90">{report.finalStateHash}</div>
          ) : null}
          {report.finalStacks ? (
            <div className="mt-1 font-mono text-[12px]">stacks {JSON.stringify(report.finalStacks)}</div>
          ) : null}
          {report.error ? <div className="mt-1 text-[12px]">{report.error}</div> : null}
          {report.note ? <div className="mt-2 text-[12px] opacity-70">{report.note}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
