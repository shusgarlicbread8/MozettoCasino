import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const expected = process.env.ADMIN_TOKEN;
  if (!expected) {
    return new NextResponse("ADMIN_TOKEN not configured", { status: 503 });
  }

  const headerToken = req.headers.get("x-admin-token");
  const cookieToken = req.cookies.get("admin_token")?.value;
  if (headerToken === expected || cookieToken === expected) {
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
