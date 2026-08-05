import { createClient } from "@/lib/supabase/client";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const GAME = process.env.NEXT_PUBLIC_GAME_WS_URL ?? "ws://localhost:4001/ws";

export function gameWsUrl() {
  return GAME;
}

export function gameHttpUrl() {
  return process.env.NEXT_PUBLIC_GAME_HTTP_URL ?? "http://localhost:4001";
}

async function authHeaders(hasJsonBody: boolean): Promise<HeadersInit> {
  const headers: Record<string, string> = {};
  // Fastify rejects Content-Type: application/json with an empty body (breaks leave/top-up).
  if (hasJsonBody) headers["content-type"] = "application/json";
  try {
    const supabase = createClient();
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (token) headers.Authorization = `Bearer ${token}`;
  } catch {
    /* anonymous */
  }
  return headers;
}

export class ApiError extends Error {
  data: Record<string, unknown>;
  status: number;
  constructor(message: string, status: number, data: Record<string, unknown>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  let body = init?.body;
  // POST/PATCH/PUT with JSON content-type need a body — default to {}.
  const wantsJson =
    body != null ||
    method === "POST" ||
    method === "PUT" ||
    method === "PATCH";
  if (wantsJson && (body == null || body === "")) {
    body = "{}";
  }
  const res = await fetch(`${API}${path}`, {
    ...init,
    body,
    credentials: "include",
    headers: {
      ...(await authHeaders(body != null)),
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      (data as { message?: string }).message || (data as { error?: string }).error || res.statusText;
    throw new ApiError(message, res.status, data as Record<string, unknown>);
  }
  return data as T;
}

export async function getAccessToken() {
  try {
    const supabase = createClient();
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}
