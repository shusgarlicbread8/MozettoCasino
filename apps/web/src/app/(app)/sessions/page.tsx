"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
export default function Page() {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => { api<{sessions:any[]}>("/v1/sessions").then(r=>setRows(r.sessions)).catch(()=>{}); }, []);
  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="text-3xl font-semibold">Sessions</h1>
      <div className="mt-6 overflow-hidden rounded-2xl border border-white/[0.07] bg-[#0A0A0A]">
        {rows.map(s => (
          <div key={s.id} className="flex items-center justify-between border-b border-white/[0.05] px-5 py-3 text-sm">
            <div>
              <div className="font-medium">{s.table_name}</div>
              <div className="font-mono text-[10px] text-[#5A5A5A]">{s.status} · {new Date(s.started_at).toLocaleString()}</div>
            </div>
            <div className="font-mono text-[#FFB020]">${Number(s.stack).toLocaleString()}</div>
          </div>
        ))}
        {!rows.length && <div className="px-5 py-8 text-sm text-[#6A6A6A]">No sessions yet — join a table from Poker.</div>}
      </div>
    </div>
  );
}
