"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient, supabaseConfigured } from "@/lib/supabase/client";

/** OAuth / magic-link / email-confirm callback. */
export default function AuthCallbackPage() {
  const router = useRouter();
  const [message, setMessage] = useState("Completing sign-in…");

  useEffect(() => {
    async function run() {
      if (!supabaseConfigured()) {
        router.replace("/sign-in");
        return;
      }
      try {
        const supabase = createClient();
        const url = new URL(window.location.href);
        if (url.searchParams.get("code")) {
          const { error } = await supabase.auth.exchangeCodeForSession(window.location.href);
          if (error) throw error;
        }
        const { data } = await supabase.auth.getSession();
        if (data.session?.access_token) {
          const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
          await fetch(`${API}/v1/auth/session`, {
            method: "POST",
            credentials: "include",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ accessToken: data.session.access_token }),
          }).catch(() => null);
        }
        setMessage("Seat ready. Redirecting…");
        router.replace("/home");
        router.refresh();
      } catch (e) {
        setMessage(e instanceof Error ? e.message : "Could not complete sign-in");
        setTimeout(() => router.replace("/sign-in"), 2200);
      }
    }
    void run();
  }, [router]);

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "#080808",
        color: "#9A9A9A",
        fontSize: 13.5,
      }}
    >
      {message}
    </div>
  );
}
