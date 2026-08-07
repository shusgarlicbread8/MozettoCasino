"use client";

import { useState } from "react";
import { shortHash } from "@/lib/verify/api";

export function HashRow({
  label,
  value,
  href,
}: {
  label: string;
  value: string | null | undefined;
  href?: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const display = value ?? "—";

  async function copy() {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)_auto] items-baseline gap-2 py-1 font-mono text-[12.5px] sm:grid-cols-[9rem_minmax(0,1fr)_auto]">
      <dt className="text-[#666]">{label}</dt>
      <dd className="min-w-0 break-all text-[#cfcfcf]" title={display}>
        {href && value ? (
          <a href={href} target="_blank" rel="noreferrer">
            {shortHash(value, 14, 8)}
          </a>
        ) : (
          shortHash(value, 14, 8)
        )}
      </dd>
      {value ? (
        <button
          type="button"
          onClick={copy}
          className="text-[11px] text-[#5A5A5A] hover:text-[#00E676]"
        >
          {copied ? "copied" : "copy"}
        </button>
      ) : (
        <span />
      )}
    </div>
  );
}
