"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { resolveVerifyQuery } from "@/lib/verify/api";

export function VerifySearch({ initial = "" }: { initial?: string }) {
  const router = useRouter();
  const [q, setQ] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = q.trim();
    if (!trimmed) return;
    setError(null);
    startTransition(async () => {
      try {
        // Prefer direct navigation for 0x session-looking ids / bare session paths
        if (trimmed.startsWith("0x") && trimmed.length === 66) {
          // Could be session id or hash — ask resolve
        }
        const resolved = await resolveVerifyQuery(trimmed);
        if (resolved.error === "not_found" || !resolved.href || resolved.href === "/verify") {
          // Fall back: treat as session id
          router.push(`/verify/${encodeURIComponent(trimmed)}`);
          return;
        }
        router.push(resolved.href);
      } catch {
        setError("Could not reach the verify API. Check NEXT_PUBLIC_API_URL.");
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <label className="block text-[12px] text-[#8A8A8A]">
        Session id, hand id, event hash, hand root, or settlement digest
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="0x… or hand id"
          spellCheck={false}
          className="min-w-0 flex-1 rounded-lg border border-white/[0.1] bg-[#0A0A0A] px-3 py-2.5 font-mono text-[13px] text-[#ededed] outline-none focus:border-[#00E676]/50"
        />
        <button
          type="submit"
          disabled={pending || !q.trim()}
          className="rounded-lg bg-[#00E676] px-4 py-2.5 text-sm font-medium text-[#04140c] disabled:opacity-40"
        >
          {pending ? "Resolving…" : "Resolve"}
        </button>
      </div>
      {error ? <p className="text-sm text-red-400">{error}</p> : null}
    </form>
  );
}
