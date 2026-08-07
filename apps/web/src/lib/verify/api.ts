import type { ResolvePayload, VerifyHandPayload, VerifySessionPayload } from "./types";

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "");

export function apiBase() {
  return API_URL;
}

export async function fetchVerifySession(sessionId: string): Promise<VerifySessionPayload | null> {
  const res = await fetch(`${API_URL}/v1/verify/session/${encodeURIComponent(sessionId)}`, {
    cache: "no-store",
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`verify session ${res.status}`);
  return res.json();
}

export async function fetchVerifyHand(handId: string): Promise<VerifyHandPayload | null> {
  const res = await fetch(`${API_URL}/v1/verify/hand/${encodeURIComponent(handId)}`, {
    cache: "no-store",
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`verify hand ${res.status}`);
  return res.json();
}

export async function resolveVerifyQuery(q: string): Promise<ResolvePayload> {
  const res = await fetch(`${API_URL}/v1/verify/resolve?q=${encodeURIComponent(q)}`, {
    cache: "no-store",
  });
  if (res.status === 404) return { kind: "not_found", href: "/verify", error: "not_found" };
  if (!res.ok) throw new Error(`verify resolve ${res.status}`);
  return res.json();
}

export function explorerTx(chainId: number, txHash: string): string | null {
  if (chainId === 8453) return `https://basescan.org/tx/${txHash}`;
  if (chainId === 84532) return `https://sepolia.basescan.org/tx/${txHash}`;
  return null;
}

export function shortHash(h: string | null | undefined, head = 10, tail = 6): string {
  if (!h) return "—";
  if (h.length <= head + tail + 1) return h;
  return `${h.slice(0, head)}…${h.slice(-tail)}`;
}
