import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login"];

function configuredTokens(): string[] {
  return [process.env.ADMIN_TOKEN, process.env.ADMIN_READ_TOKEN, process.env.ADMIN_MUTATE_TOKEN]
    .map((t) => t?.trim())
    .filter((t): t is string => Boolean(t));
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const tokens = configuredTokens();
  if (!tokens.length) {
    return new NextResponse(
      "Admin auth not configured (ADMIN_TOKEN and/or ADMIN_READ_TOKEN / ADMIN_MUTATE_TOKEN)",
      { status: 503 },
    );
  }

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

  if (pathname === "/login" || req.nextUrl.searchParams.has("token")) {
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
