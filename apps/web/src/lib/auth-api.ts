import { createClient } from "@/lib/supabase/client";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export type AuthUser = {
  authUserId: string;
  profileId: string;
  email: string;
  handle: string;
  displayName: string;
  agentHandle?: string | null;
};

async function bearerHeaders(): Promise<HeadersInit> {
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return {
    "content-type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function authFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      ...(await bearerHeaders()),
      ...(init?.headers ?? {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error((data as { message?: string }).message || (data as { error?: string }).error || res.statusText);
    (err as Error & { code?: string }).code = (data as { error?: string }).error;
    throw err;
  }
  return data as T;
}

/** @deprecated Prefer signUpWithEmail from @/lib/auth — kept for any residual callers. */
export async function signup(email: string, password: string, displayName?: string) {
  const { signUpWithEmail } = await import("@/lib/auth");
  const res = await signUpWithEmail(email, password, displayName);
  if (res.needsEmailConfirmation || !res.profile) {
    throw new Error("Confirm your email, then sign in.");
  }
  return { user: res.profile };
}

/** @deprecated Prefer signInWithEmail from @/lib/auth */
export async function login(email: string, password: string) {
  const { signInWithEmail } = await import("@/lib/auth");
  const res = await signInWithEmail(email, password);
  return { user: res.profile };
}

export function logout() {
  return import("@/lib/auth").then((m) => m.signOut());
}

export function authMe() {
  return authFetch<{
    user: AuthUser;
    available: number;
    atTables: number;
  }>("/v1/auth/me");
}
