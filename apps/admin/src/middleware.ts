import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/api/admin"];

function configuredTokens(): string[] {
  return [process.env.ADMIN_TOKEN, process.env.ADMIN_READ_TOKEN, process.env.ADMIN_MUTATE_TOKEN]
    .map((t) => t?.trim())
    .filter((t): t is string => Boolean(t));
}

function adminAuthConfigured(): boolean {
  return configuredTokens().length > 0 || Boolean(process.env.ADMIN_SESSION_SECRET?.trim());
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  if (!adminAuthConfigured()) {
    return new NextResponse(
      "Admin auth not configured (ADMIN_SESSION_SECRET and/or ADMIN_TOKEN / ADMIN_READ_TOKEN / ADMIN_MUTATE_TOKEN)",
      { status: 503 },
    );
  }

  const walletSession = req.cookies.get("mozetto_admin_session")?.value;
  if (walletSession) {
    return NextResponse.next();
  }

  const tokens = configuredTokens();
  const headerToken = req.headers.get("x-admin-token");
  const cookieRaw = req.cookies.get("admin_token")?.value;
  let cookieToken = cookieRaw;
  if (cookieRaw) {
    try {
      cookieToken = decodeURIComponent(cookieRaw);
    } catch {
      cookieToken = cookieRaw;
    }
  }

  if ((headerToken && tokens.includes(headerToken)) || (cookieToken && tokens.includes(cookieToken))) {
    return NextResponse.next();
  }

  if (pathname === "/login" || req.nextUrl.searchParams.has("token") || req.nextUrl.searchParams.has("breakglass")) {
    return NextResponse.next();
  }

  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.searchParams.set("from", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
