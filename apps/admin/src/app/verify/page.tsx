"use client";

import { useState } from "react";

export default function VerifyHelperPage() {
  const [sessionId, setSessionId] = useState("");
  const webOrigin = process.env.NEXT_PUBLIC_WEB_ORIGIN ?? "http://localhost:3000";
  const href = sessionId.trim() ? `${webOrigin}/verify/${sessionId.trim()}` : "";

  return (
    <div className="space-y-4 max-w-lg">
      <h1 className="text-xl font-semibold">Verify link helper</h1>
      <p className="muted text-sm">Build a public verify URL for an on-chain session.</p>
      <label className="block text-sm">
        Session ID
        <input
          className="mt-1 w-full bg-[#141414] border border-[#2a2a2a] rounded px-3 py-2 text-sm font-mono"
          value={sessionId}
          onChange={(e) => setSessionId(e.target.value)}
          placeholder="0x…"
        />
      </label>
      {href && (
        <div className="card text-sm break-all">
          <a href={href} target="_blank" rel="noreferrer">
            {href}
          </a>
        </div>
      )}
    </div>
  );
}
