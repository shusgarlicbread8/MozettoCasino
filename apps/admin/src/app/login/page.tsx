"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const from = params.get("from") ?? "/";
  const tokenParam = params.get("token");

  useEffect(() => {
    if (tokenParam) {
      document.cookie = `admin_token=${encodeURIComponent(tokenParam)}; path=/; SameSite=Strict`;
      router.replace(from);
    }
  }, [tokenParam, from, router]);

  return (
    <div className="card max-w-md">
      <h1 className="text-lg font-semibold mb-2">Admin login</h1>
      <p className="muted text-sm mb-4">
        Set cookie via <code>?token=YOUR_ADMIN_TOKEN</code> or send <code>x-admin-token</code> header.
        Production must use MFA-backed SSO in front of this app.
      </p>
      {!tokenParam && (
        <p className="text-sm">
          Append your token: <code>/login?token=…</code>
        </p>
      )}
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="muted text-sm">Loading…</div>}>
      <LoginForm />
    </Suspense>
  );
}
