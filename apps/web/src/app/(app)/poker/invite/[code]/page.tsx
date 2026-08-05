"use client";
import { useParams } from "next/navigation";
export default function Page() {
  const { code } = useParams<{code:string}>();
  return (
    <div className="mx-auto max-w-lg px-6 py-16 text-center">
      <h1 className="text-3xl font-semibold">Private invite</h1>
      <p className="mt-3 font-mono text-[#00E676]">{code}</p>
      <p className="mt-3 text-sm text-[#7A7A7A]">Invite-only tables resolve by code. Try MERIDIAN for Meridian Private once seating opens.</p>
      <a href="/poker" className="mt-8 inline-block text-sm">Back to poker →</a>
    </div>
  );
}
