"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
export default function Page() {
  const [rows, setRows] = useState<{id:string;title:string;body:string;created_at:string;href?:string}[]>([]);
  useEffect(() => { api<{notifications:typeof rows}>("/v1/notifications").then(r=>setRows(r.notifications)).catch(()=>{}); }, []);
  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="text-3xl font-semibold">Notifications</h1>
      <div className="mt-6 overflow-hidden rounded-2xl border border-white/[0.07] bg-[#0A0A0A]">
        {rows.map(n => (
          <a key={n.id} href={n.href || "/home"} className="block border-b border-white/[0.05] px-5 py-4 text-[#EDEDED]">
            <div className="text-sm font-medium">{n.title}</div>
            <div className="mt-1 text-[12px] text-[#6A6A6A]">{n.body}</div>
          </a>
        ))}
      </div>
    </div>
  );
}
