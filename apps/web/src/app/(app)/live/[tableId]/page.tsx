"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { gameWsUrl } from "@/lib/api";
export default function Page() {
  const { tableId } = useParams<{tableId:string}>();
  const [street, setStreet] = useState("waiting");
  const [pot, setPot] = useState(0);
  const [board, setBoard] = useState<any[]>([]);
  useEffect(() => {
    const ws = new WebSocket(gameWsUrl());
    ws.onopen = () => ws.send(JSON.stringify({ type: "subscribe_table", tableId, role: "spectator" }));
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === "snapshot" && msg.state) {
        setStreet(msg.state.street);
        setPot(msg.state.pot);
        setBoard(msg.state.board || []);
      }
    };
    return () => ws.close();
  }, [tableId]);
  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <div className="rounded-lg border border-[rgba(255,82,82,.25)] bg-[rgba(255,82,82,.08)] px-3 py-2 font-mono text-[11px] text-[#FF5252]">SPECTATOR · 90s delay policy (live feed for MVP demo)</div>
      <h1 className="mt-6 text-2xl font-semibold">{tableId}</h1>
      <div className="mt-4 font-mono text-[#00E676]">POT {Math.round(pot)} · {street}</div>
      <div className="mt-4 flex gap-2">{board.map((c,i)=><div key={i} className="rounded bg-white px-2 py-1 font-mono text-black">{c.rank}{c.suit}</div>)}</div>
      <Link href={`/table/${tableId}`} className="mt-8 inline-block text-sm">Open owner table view →</Link>
    </div>
  );
}
