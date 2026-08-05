import Link from "next/link";
export default function Page() {
  return (
    <div className="mx-auto max-w-3xl px-8 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Status</h1>
      <div className="mt-4 space-y-3 text-[14px] leading-relaxed text-[#8A8A8A]"><p>Web · API · Game server · Agent runtime · Supabase Postgres</p><p>Check <code>/health</code> on API (:4000) and game-server (:4001).</p></div>
      <Link href="/home" className="mt-8 inline-block text-sm">Back to lobby →</Link>
    </div>
  );
}
