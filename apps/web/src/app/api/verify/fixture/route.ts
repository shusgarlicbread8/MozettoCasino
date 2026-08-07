import { NextResponse } from "next/server";
import { runFixture, type EngineFixture } from "@mozetto/game-rules";

export const runtime = "nodejs";

/**
 * WP-090 — Server-side fixture verify using the frozen TS engine.
 * Prefer browser WASM when `/poker-wasm/` is published; this is the always-on fallback.
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const fixture = (body as { fixture?: EngineFixture }).fixture;
  if (!fixture || typeof fixture !== "object" || !fixture.id || !Array.isArray(fixture.steps)) {
    return NextResponse.json(
      { ok: false, error: "fixture_required", note: "Body must be { fixture: EngineFixture }" },
      { status: 400 },
    );
  }

  try {
    const results = runFixture(fixture);
    const last = results[results.length - 1];
    const stacks = last?.state.seats.map((s) => s.stack) ?? null;
    return NextResponse.json({
      ok: true,
      engine: "typescript",
      workPacket: "WP-090",
      id: fixture.id,
      finalStacks: stacks,
      finalStateHash: last?.stateHash ?? null,
      steps: results.length,
      note: "Verified with @mozetto/game-rules (WP-030). For WASM: pnpm sync:poker-wasm-web && pnpm test:poker-wasm.",
    });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      engine: "typescript",
      workPacket: "WP-090",
      id: fixture.id,
      error: e instanceof Error ? e.message : "verify_failed",
      note: "Fixture expectations failed under the TS freeze engine.",
    });
  }
}
