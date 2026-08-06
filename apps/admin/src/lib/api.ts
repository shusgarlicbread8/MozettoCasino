const API_URL = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export function getApiUrl() {
  return API_URL.replace(/\/$/, "");
}

export async function adminFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token =
    typeof document !== "undefined"
      ? document.cookie
          .split("; ")
          .find((c) => c.startsWith("admin_token="))
          ?.split("=")[1]
      : process.env.ADMIN_TOKEN;

  const res = await fetch(`${getApiUrl()}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      ...(token ? { "x-admin-token": token } : {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${path}: ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

export async function fetchHealth(): Promise<{ ok: boolean }> {
  const res = await fetch(`${getApiUrl()}/health`, { cache: "no-store" });
  return res.json();
}
