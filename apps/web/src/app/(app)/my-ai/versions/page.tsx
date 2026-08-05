import Link from "next/link";
export default function Page() {
  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Versions</h1>
      <div className="mt-4 space-y-3 text-[14px] leading-relaxed text-[#8A8A8A]"><p>VELVET v1–v4 are seeded in Postgres. Promote / rollback hooks will call agent_versions.</p></div>
    </div>
  );
}
