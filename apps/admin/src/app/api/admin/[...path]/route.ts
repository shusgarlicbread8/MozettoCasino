import { NextRequest, NextResponse } from "next/server";

const API_URL = (process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(
  /\/$/,
  "",
);

function forwardHeaders(req: NextRequest): Headers {
  const headers = new Headers();
  headers.set("content-type", req.headers.get("content-type") ?? "application/json");
  const requestId = req.headers.get("x-request-id");
  if (requestId) headers.set("x-request-id", requestId);
  const adminToken = req.headers.get("x-admin-token");
  if (adminToken) headers.set("x-admin-token", adminToken);

  const session = req.cookies.get("mozetto_admin_session")?.value;
  const legacy = req.cookies.get("admin_token")?.value;
  const cookieParts: string[] = [];
  if (session) cookieParts.push(`mozetto_admin_session=${session}`);
  if (legacy) cookieParts.push(`admin_token=${legacy}`);
  if (cookieParts.length) headers.set("cookie", cookieParts.join("; "));

  return headers;
}

function copySetCookies(upstream: Response, res: NextResponse): void {
  const raw = upstream.headers.getSetCookie?.() ?? [];
  for (const c of raw) {
    res.headers.append("set-cookie", c);
  }
  const legacy = upstream.headers.get("set-cookie");
  if (legacy && !raw.length) {
    res.headers.append("set-cookie", legacy);
  }
}

async function proxy(req: NextRequest, pathSegments: string[]): Promise<NextResponse> {
  const subpath = pathSegments.join("/");
  const url = `${API_URL}/${subpath}${req.nextUrl.search}`;
  const init: RequestInit = {
    method: req.method,
    headers: forwardHeaders(req),
    cache: "no-store",
  };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = await req.text();
  }

  const upstream = await fetch(url, init);
  const body = await upstream.arrayBuffer();
  const res = new NextResponse(body, { status: upstream.status });
  upstream.headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") return;
    res.headers.set(key, value);
  });
  copySetCookies(upstream, res);
  return res;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  return proxy(req, path);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  return proxy(req, path);
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  return proxy(req, path);
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  return proxy(req, path);
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  return proxy(req, path);
}
