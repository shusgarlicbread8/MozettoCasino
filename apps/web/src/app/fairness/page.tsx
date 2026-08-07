import Link from "next/link";

export default function Page() {
  return (
    <div className="mx-auto max-w-3xl px-8 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Fairness</h1>
      <div className="mt-4 space-y-3 text-[14px] leading-relaxed text-[#8A8A8A]">
        <p>
          Before each hand the protocol commits dealer and randomness roots. After settlement, public
          event / hand / balance roots and attestor digests can be checked independently.
        </p>
        <p>
          Every table event carries a sequence number and event hash chain. Clients never mutate
          authoritative state. Supabase Realtime is for lobby/presence only.
        </p>
        <p>
          Use the public{" "}
          <Link href="/verify">Verify Game</Link> page to resolve a session or hand by id/hash, inspect
          VRF and settlement artifacts, and run a local fixture verifier (WASM when published, otherwise
          the frozen TypeScript engine).
        </p>
        <p>
          Offline CLI evidence (no Mozetto API trust):{" "}
          <code className="text-[#6A6A6A]">pnpm test:poker-wasm</code>,{" "}
          <code className="text-[#6A6A6A]">pnpm verify:randomness</code>,{" "}
          <code className="text-[#6A6A6A]">cargo run -p poker-replay -- verify-events</code>.
        </p>
      </div>
      <div className="mt-8 flex flex-wrap gap-4 text-sm">
        <Link href="/verify">Open Verify Game →</Link>
        <Link href="/home">Back to lobby →</Link>
      </div>
    </div>
  );
}
