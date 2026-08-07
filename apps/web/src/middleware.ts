import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PROTECTED = [
  "/home",
  "/poker",
  "/wallet",
  "/my-ai",
  "/table",
  "/live",
  "/rankings",
  "/replays",
  "/result",
  "/sessions",
  "/notifications",
  "/settings",
  "/profile",
];

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const path = request.nextUrl.pathname;

  const hasWalletSession = Boolean(request.cookies.get("mozetto_session")?.value);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  let supabaseUser: { id: string } | null = null;

  if (url && key) {
    const supabase = createServerClient(url, key, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    });
    const { data } = await supabase.auth.getUser();
    supabaseUser = data.user;
  }

  const needsAuth = PROTECTED.some((p) => path === p || path.startsWith(p + "/"));
  const isAuthed = Boolean(supabaseUser) || hasWalletSession;

  if (needsAuth && !isAuthed) {
    const redirect = request.nextUrl.clone();
    // Prefer on-chain portal if they were browsing with a wallet hint; default demo sign-in
    redirect.pathname = path.startsWith("/onchain") ? "/onchain" : "/sign-in";
    redirect.searchParams.set("next", path);
    return NextResponse.redirect(redirect);
  }

  if ((path === "/sign-in" || path === "/sign-up") && supabaseUser) {
    const redirect = request.nextUrl.clone();
    redirect.pathname = "/home";
    return NextResponse.redirect(redirect);
  }

  if (path === "/onchain" && hasWalletSession && !supabaseUser) {
    // Allow staying on portal to switch network / reconnect
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
