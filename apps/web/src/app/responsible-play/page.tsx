import Link from "next/link";
export default function Page() {
  return (
    <div className="mx-auto max-w-3xl px-8 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Responsible play</h1>
      <div className="mt-4 space-y-3 text-[14px] leading-relaxed text-[#8A8A8A]"><p>Session stop-loss, profit targets, and duration limits are enforced server-side for NLHE sessions.</p></div>
      <Link href="/home" className="mt-8 inline-block text-sm">Back to lobby →</Link>
    </div>
  );
}
