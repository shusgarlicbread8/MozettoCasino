"use client";
import { useState } from "react";
import { api } from "@/lib/api";
export default function Page() {
  const [amount, setAmount] = useState(1000);
  const [msg, setMsg] = useState("");
  async function go() {
    const r = await api<{available:number}>("/v1/wallet/deposit", { method:"POST", body: JSON.stringify({ amount }) });
    setMsg(`Deposited. Available $${r.available.toLocaleString()}`);
  }
  return (
    <div className="mx-auto max-w-md px-6 py-10">
      <h1 className="text-3xl font-semibold">Deposit</h1>
      <p className="mt-2 text-sm text-[#7A7A7A]">Fake USDC credit via clearing account. Base Sepolia later.</p>
      <input type="number" value={amount} onChange={e=>setAmount(Number(e.target.value))} className="mt-6 w-full rounded-xl border border-white/10 bg-[#0A0A0A] px-4 py-3 font-mono" />
      <button onClick={go} className="mt-4 w-full rounded-xl bg-[#00E676] py-3 font-semibold text-[#050505]">Confirm deposit</button>
      {msg && <p className="mt-4 text-sm text-[#00E676]">{msg}</p>}
    </div>
  );
}
