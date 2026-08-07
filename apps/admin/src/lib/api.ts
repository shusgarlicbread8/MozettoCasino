const API_URL = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export function getApiUrl() {
  return API_URL.replace(/\/$/, "");
}

/** Prefer read token for SSR; never use NEXT_PUBLIC_* for secrets. */
function serverAdminToken(): string | undefined {
  return (
    process.env.ADMIN_READ_TOKEN?.trim() ||
    process.env.ADMIN_TOKEN?.trim() ||
    process.env.ADMIN_MUTATE_TOKEN?.trim() ||
    undefined
  );
}

function browserAdminToken(): string | undefined {
  if (typeof document === "undefined") return undefined;
  const raw = document.cookie
    .split("; ")
    .find((c) => c.startsWith("admin_token="))
    ?.slice("admin_token=".length);
  if (!raw) return undefined;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export async function adminFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = typeof document !== "undefined" ? browserAdminToken() : serverAdminToken();

  const res = await fetch(`${getApiUrl()}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
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
