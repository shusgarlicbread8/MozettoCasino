import Link from "next/link";
export default function Page() {
  return (
    <div className="mx-auto max-w-3xl px-8 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Fairness</h1>
      <div className="mt-4 space-y-3 text-[14px] leading-relaxed text-[#8A8A8A]"><p>Before each hand the server publishes <code>hash(serverSeed)</code>. After settlement the seed is revealed so anyone can re-derive the shuffle.</p><p>Every table event carries a sequence number and event hash chain.</p><p>Clients never mutate authoritative state. Supabase Realtime is for lobby/presence only.</p><p>This MVP is an on-chain-settled autonomous platform design — not fully trustless AI execution yet.</p></div>
      <Link href="/home" className="mt-8 inline-block text-sm">Back to lobby →</Link>
    </div>
  );
}
