"use client";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
export default function Page() {
  const { handId } = useParams<{handId:string}>();
  const [data, setData] = useState<any>(null);
  useEffect(()=>{ api(`/v1/replays/${handId}`).then(setData).catch(()=>{}); },[handId]);
  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">{handId}</h1>
      <div className="mt-2 font-mono text-[11px] text-[#5A5A5A]">seed commit {data?.hand?.seed_commit?.slice(0,32)}…</div>
      <div className="mt-6 grid grid-cols-2 gap-4">
        <div className="rounded-2xl border border-white/[0.07] bg-[#0A0A0A] p-4">
          <div className="mb-3 text-sm font-semibold">Events</div>
          {(data?.events||[]).map((e:any)=>(
            <div key={e.sequence} className="border-t border-white/[0.05] py-2 font-mono text-[10.5px] text-[#9A9A9A]">#{e.sequence} {e.event_type}</div>
          ))}
        </div>
        <div className="rounded-2xl border border-white/[0.07] bg-[#0A0A0A] p-4">
          <div className="mb-3 text-sm font-semibold">Decisions</div>
          {(data?.decisions||[]).map((d:any)=>(
            <div key={d.id} className="border-t border-white/[0.05] py-2 text-[12px]">
              <span className="font-mono text-[#00E676]">{d.action}</span> <span className="text-[#6A6A6A]">{d.reason_code}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
