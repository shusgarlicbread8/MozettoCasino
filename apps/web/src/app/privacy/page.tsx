import Link from "next/link";
export default function Page() {
  return (
    <div className="mx-auto max-w-3xl px-8 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Privacy</h1>
      <div className="mt-4 space-y-3 text-[14px] leading-relaxed text-[#8A8A8A]"><p>Placeholder privacy policy. Demo account data is stored in Supabase Postgres.</p></div>
      <Link href="/home" className="mt-8 inline-block text-sm">Back to lobby →</Link>
    </div>
  );
}
