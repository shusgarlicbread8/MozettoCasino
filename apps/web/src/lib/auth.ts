"use client";

import { createClient } from "@/lib/supabase/client";

export type AuthProfile = {
  authUserId: string;
  profileId: string;
  email: string;
  handle: string;
  displayName: string;
  agentHandle: string | null;
  available: number;
};

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

async function syncApiSession(accessToken: string) {
  await fetch(`${API}/v1/auth/session`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ accessToken }),
  }).catch(() => null);
}

async function waitForProfile(accessToken: string, attempts = 12): Promise<AuthProfile> {
  let lastError: Error | null = null;
  for (let i = 0; i < attempts; i++) {
    const res = await fetch(`${API}/v1/auth/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      credentials: "include",
    });
    if (res.ok) {
      await syncApiSession(accessToken);
      const data = await res.json();
      return {
        authUserId: data.user.authUserId,
        profileId: data.user.profileId,
        email: data.user.email,
        handle: data.user.handle,
        displayName: data.user.displayName,
        agentHandle: data.user.agentHandle ?? null,
        available: data.available ?? 0,
      };
    }
    lastError = new Error((await res.json().catch(() => ({}))).message || "Profile not ready");
    await new Promise((r) => setTimeout(r, 250));
  }
  throw lastError ?? new Error("Profile bootstrap timed out");
}

export async function signUpWithEmail(email: string, password: string, displayName?: string) {
  const supabase = createClient();
  const name = (displayName ?? "").trim();
  if (!name) throw new Error("Please enter a display name.");

  const { data, error } = await supabase.auth.signUp({
    email: email.trim().toLowerCase(),
    password,
    options: {
      data: {
        display_name: name,
        full_name: name,
        name,
      },
      emailRedirectTo: typeof window !== "undefined" ? `${window.location.origin}/auth/callback` : undefined,
    },
  });
  if (error) throw new Error(error.message);

  if (!data.session) {
    return { needsEmailConfirmation: true as const, user: data.user };
  }

  // Ensure profile/agent show the typed name even if the DB trigger raced metadata.
  await fetch(`${API}/v1/me/profile`, {
    method: "PATCH",
    credentials: "include",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${data.session.access_token}`,
    },
    body: JSON.stringify({ displayName: name }),
  }).catch(() => null);

  const profile = await waitForProfile(data.session.access_token);
  return { needsEmailConfirmation: false as const, user: data.user, profile, session: data.session };
}

export async function signInWithEmail(email: string, password: string) {
  const supabase = createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });
  if (error) throw new Error(error.message);
  if (!data.session) throw new Error("No session returned");

  const profile = await waitForProfile(data.session.access_token);
  return { user: data.user, profile, session: data.session };
}

export async function signOut() {
  const supabase = createClient();
  await supabase.auth.signOut();
  await fetch(`${API}/v1/auth/logout`, { method: "POST", credentials: "include" }).catch(() => null);
}

export async function getAccessToken() {
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
