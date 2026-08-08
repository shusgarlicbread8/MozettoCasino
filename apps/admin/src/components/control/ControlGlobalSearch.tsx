"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * MC-023 — resolve common entity ids to Control routes.
 * Deep search API can replace heuristics later without changing the shell.
 */
function resolveQuery(raw: string): string | null {
  const q = raw.trim();
  if (!q) return null;
  if (/^0x[a-fA-F0-9]{40}$/.test(q)) return `/players?q=${encodeURIComponent(q)}`;
  if (/^INC[-_]/i.test(q)) return `/incidents?q=${encodeURIComponent(q)}`;
  if (/session/i.test(q) || /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(q)) {
    return `/sessions/${encodeURIComponent(q)}`;
  }
  if (/^0x[a-fA-F0-9]{64}$/.test(q)) return `/settlement?q=${encodeURIComponent(q)}`;
  if (/table|tbl/i.test(q)) return `/sessions?q=${encodeURIComponent(q)}`;
  return `/players?q=${encodeURIComponent(q)}`;
}

export function ControlGlobalSearch() {
  const router = useRouter();
  const [value, setValue] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const href = resolveQuery(value);
    if (href) router.push(href);
  }

  return (
    <form className="ctrl-search" onSubmit={submit} role="search">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search wallet / session / tx / incident…"
        aria-label="Global search"
      />
      <button type="submit" className="ctrl-btn">
        Go
      </button>
    </form>
  );
}
