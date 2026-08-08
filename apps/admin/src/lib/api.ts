const API_URL = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export function getApiUrl() {
  return API_URL.replace(/\/$/, "");
}

/** Prefer read token for SSR fallback; never use NEXT_PUBLIC_* for secrets. */
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

function hasBrowserWalletSession(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie.split("; ").some((c) => c.startsWith("mozetto_admin_session="));
}

async function serverSessionCookieHeader(): Promise<string | undefined> {
  if (typeof document !== "undefined") return undefined;
  try {
    const { cookies } = await import("next/headers");
    const jar = await cookies();
    const session = jar.get("mozetto_admin_session")?.value;
    if (session) return `mozetto_admin_session=${session}`;
  } catch {
    /* outside RSC */
  }
  return undefined;
}

function adminRequestUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (typeof document !== "undefined") {
    return `/api/admin${normalized}`;
  }
  return `${getApiUrl()}${normalized}`;
}

export async function adminFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = typeof document !== "undefined" ? browserAdminToken() : serverAdminToken();
  const sessionCookie = await serverSessionCookieHeader();
  const useWalletSession =
    typeof document !== "undefined" ? hasBrowserWalletSession() : Boolean(sessionCookie);

  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (!useWalletSession && token) headers["x-admin-token"] = token;
  if (sessionCookie) headers.cookie = sessionCookie;

  const res = await fetch(adminRequestUrl(path), {
    ...init,
    headers,
    credentials: typeof document !== "undefined" ? "include" : undefined,
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

export type AdminMe = {
  role: string;
  capabilities: string[];
  controlCapabilities: string[];
  actorLabel: string;
  authMethod: "siwe" | "token";
  walletAddress: string | null;
  readOnlyDefault: boolean;
};

export async function fetchAdminMe(): Promise<AdminMe> {
  return adminFetch<AdminMe>("/v1/admin/me");
}
