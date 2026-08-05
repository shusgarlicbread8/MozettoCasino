import Link from "next/link";
export default function Page() {
  return (
    <div className="mx-auto max-w-3xl px-8 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Help</h1>
      <div className="mt-4 space-y-3 text-[14px] leading-relaxed text-[#8A8A8A]"><p>Join Monaco 12 from Poker, watch the AI play, inspect Wallet ledger and Replays.</p><p>Need support? Contact the operators running this deployment.</p></div>
      <Link href="/home" className="mt-8 inline-block text-sm">Back to lobby →</Link>
    </div>
  );
}
