"use client";
import { useState } from "react";
import { api } from "@/lib/api";
export default function Page() {
  const [amount, setAmount] = useState(100);
  const [msg, setMsg] = useState("");
  async function go() {
    try {
      const r = await api<{available:number}>("/v1/wallet/withdraw", { method:"POST", body: JSON.stringify({ amount }) });
      setMsg(`Withdrawn. Available $${r.available.toLocaleString()}`);
    } catch (e:any) { setMsg(e.message); }
  }
  return (
    <div className="mx-auto max-w-md px-6 py-10">
      <h1 className="text-3xl font-semibold">Withdraw</h1>
      <p className="mt-2 text-sm text-[#7A7A7A]">Fake USDC debit. Limits UI ready for real custody.</p>
      <input type="number" value={amount} onChange={e=>setAmount(Number(e.target.value))} className="mt-6 w-full rounded-xl border border-white/10 bg-[#0A0A0A] px-4 py-3 font-mono" />
      <button onClick={go} className="mt-4 w-full rounded-xl border border-white/15 py-3 font-semibold">Confirm withdraw</button>
      {msg && <p className="mt-4 text-sm text-[#00E676]">{msg}</p>}
    </div>
  );
}
