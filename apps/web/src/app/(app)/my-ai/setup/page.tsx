"use client";

import Link from "next/link";
import { useState } from "react";
import { AI_PROFILES } from "@mozetto/shared-types";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";

export default function MyAiSetupPage() {
  const { me, refresh } = useSession();
  const [selected, setSelected] = useState(me?.config?.profile_key ?? "fox");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api("/v1/me/agent", {
        method: "PATCH",
        body: JSON.stringify({ profileKey: selected, risk: "balanced" }),
      });
      await refresh();
      setNotice(`Bot style set to ${selected}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Set up your agent</h1>
      <p className="mt-2 text-sm text-[#7A7A7A]">
        Agent <span className="text-[#00E676]">{me?.agent?.handle ?? "…"}</span> is funded and ready. Pick a lightweight
        bot style — it will act for you at the table.
      </p>
      <div className="mt-6 grid grid-cols-2 gap-3">
        {AI_PROFILES.map((p) => {
          const active = selected === p.key;
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => setSelected(p.key)}
              className="rounded-2xl border p-4 text-left"
              style={{
                borderColor: active ? "rgba(0,230,118,.45)" : "rgba(255,255,255,.08)",
                background: active ? "rgba(0,230,118,.08)" : "#0A0A0A",
              }}
            >
              <div className="font-medium">{p.label}</div>
              <div className="mt-1 text-[12px] text-[#6A6A6A]">{p.blurb}</div>
            </button>
          );
        })}
      </div>
      {error ? <div className="mt-4 text-sm text-[#FF8A80]">{error}</div> : null}
      {notice ? <div className="mt-4 text-sm text-[#00E676]">{notice}</div> : null}
      <div className="mt-8 flex gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => void save()}
          className="rounded-xl bg-[#00E676] px-5 py-3 text-sm font-semibold text-[#050505] disabled:opacity-60"
        >
          {busy ? "Saving…" : "Save bot style"}
        </button>
        <Link href="/poker" className="rounded-xl border border-white/15 px-5 py-3 text-sm text-[#EDEDED]">
          Enter poker lobby
        </Link>
      </div>
    </div>
  );
}
