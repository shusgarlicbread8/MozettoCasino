/** Comma-separated allowlist, plus localhost for local/dev. */
export function webOrigins(): string[] {
  const raw = process.env.WEB_ORIGINS || process.env.WEB_ORIGIN || "http://localhost:3000";
  const listed = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const defaults = ["http://localhost:3000", "http://127.0.0.1:3000"];
  return [...new Set([...listed, ...defaults])];
}

/** Allow exact WEB_ORIGIN(S) and any *.vercel.app preview/production host. */
export function corsOriginCheck(origin: string | undefined, cb: (err: Error | null, allow: boolean) => void) {
  if (!origin) return cb(null, true);
  const allowlist = webOrigins();
  if (allowlist.includes(origin)) return cb(null, true);
  try {
    const host = new URL(origin).hostname;
    if (host.endsWith(".vercel.app") || host === "vercel.app") return cb(null, true);
  } catch {
    /* ignore */
  }
  return cb(null, false);
}

export function sessionCookieOpts() {
  const crossSite = (process.env.COOKIE_SAMESITE || "").toLowerCase() === "none";
  const secure =
    process.env.COOKIE_SECURE === "1" ||
    process.env.NODE_ENV === "production" ||
    crossSite;
  return {
    path: "/",
    httpOnly: true as const,
    sameSite: (crossSite ? "none" : "lax") as "none" | "lax",
    secure,
    maxAge: 60 * 60 * 24 * 30,
  };
}

/** Mozetto Control admin session cookie (distinct from player mozetto_session). */
export function adminSessionCookieOpts() {
  const crossSite = (process.env.COOKIE_SAMESITE || "").toLowerCase() === "none";
  const secure =
    process.env.COOKIE_SECURE === "1" ||
    process.env.NODE_ENV === "production" ||
    crossSite;
  const ttlHours = Number(process.env.ADMIN_SESSION_TTL_HOURS ?? 6);
  const maxAge = Math.min(Math.max(ttlHours, 1), 24) * 60 * 60;
  return {
    path: "/",
    httpOnly: true as const,
    sameSite: "strict" as const,
    secure,
    maxAge,
  };
}
