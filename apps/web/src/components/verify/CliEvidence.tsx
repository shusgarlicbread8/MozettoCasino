import type { LocalVerifyHints } from "@/lib/verify/types";

const DEFAULT_HINTS: LocalVerifyHints = {
  wasm: {
    build: "pnpm build:poker-wasm",
    run: "pnpm test:poker-wasm",
    docs: "docs/WP-035_WASM_VERIFIER.md",
  },
  replayEvents: {
    run: "cargo run -q -p poker-replay -- verify-events --golden 03",
    docs: "docs/WP-064_REPLAY_VERIFIER.md",
  },
  randomness: {
    run: "pnpm verify:randomness",
    docs: "docs/WP-055_RANDOMNESS_VERIFIER.md",
  },
  replayService: {
    verifySession: "POST http://localhost:4004/v1/verify-session",
    verifyTranscript: "POST http://localhost:4004/v1/verify-transcript",
  },
};

export function CliEvidence({ hints }: { hints?: LocalVerifyHints | null }) {
  const h = hints ?? DEFAULT_HINTS;
  const rows = [
    { k: "WASM fixtures", cmd: h.wasm.run, note: `Build first: ${h.wasm.build}` },
    { k: "Event chain (Rust)", cmd: h.replayEvents.run, note: h.replayEvents.docs },
    { k: "Randomness", cmd: h.randomness.run, note: h.randomness.docs },
    { k: "Replay service", cmd: h.replayService.verifyTranscript, note: "Offline body; no Mozetto API trust" },
  ];
  return (
    <ul className="space-y-3 text-[13px]">
      {rows.map((r) => (
        <li key={r.k} className="rounded-lg border border-white/[0.07] bg-[#0A0A0A] px-3 py-3">
          <div className="text-[11px] uppercase tracking-[0.12em] text-[#666]">{r.k}</div>
          <pre className="mt-1.5 overflow-x-auto font-mono text-[12px] text-[#00E676]">{r.cmd}</pre>
          <div className="mt-1 text-[12px] text-[#5A5A5A]">{r.note}</div>
        </li>
      ))}
    </ul>
  );
}
