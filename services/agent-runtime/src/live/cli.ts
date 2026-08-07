#!/usr/bin/env node
/**
 * WP-107 live Groq table smoke CLI.
 *
 *   pnpm smoke:groq-table
 *   pnpm smoke:groq-table -- --hands 100 --mode mock
 *   pnpm smoke:groq-table -- --hands 100 --mode live   # requires GROQ_API_KEY
 */

import { runLiveTableSmoke } from "./table-smoke.js";
import type { ResolvedAgentRuntimeMode } from "./mode.js";
import type { PresetKey } from "../policy/presets.js";

function arg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx < 0) return undefined;
  return process.argv[idx + 1];
}

function has(flag: string): boolean {
  return process.argv.includes(flag);
}

async function main(): Promise<void> {
  const hands = Number(arg("--hands") ?? "3");
  const modeRaw = (arg("--mode") ?? process.env.AGENT_RUNTIME_MODE ?? "auto").toLowerCase();
  let mode: ResolvedAgentRuntimeMode | undefined;
  if (modeRaw === "mock" || modeRaw === "live") mode = modeRaw;
  else if (modeRaw === "auto") {
    mode = process.env.GROQ_API_KEY?.trim() ? "live" : "mock";
  }

  const profilesRaw = arg("--profiles") ?? "shark,professor";
  const [a, b] = profilesRaw.split(",").map((s) => s.trim()) as [PresetKey, PresetKey];

  if (mode === "live" && !process.env.GROQ_API_KEY?.trim()) {
    console.error("ERROR: --mode live requires GROQ_API_KEY (never commit the key)");
    process.exit(2);
  }

  const quiet = has("--quiet");
  if (!quiet) {
    console.log(
      JSON.stringify(
        {
          workPacket: "WP-107",
          hands,
          mode: mode ?? "auto",
          profiles: [a, b],
          tip: "For 100+ hands: pnpm smoke:groq-table -- --hands 100 --mode mock",
        },
        null,
        2,
      ),
    );
  }

  const result = await runLiveTableSmoke({
    hands: Number.isFinite(hands) ? hands : 3,
    mode,
    profiles: [a || "shark", b || "professor"],
    skipCadence: !has("--cadence"),
    onHand: quiet
      ? undefined
      : (info) => {
          if (info.handNumber % Math.max(1, Math.floor(hands / 10)) === 0 || info.handNumber === hands) {
            console.error(
              `[hand ${info.handNumber}/${hands}] actions=${info.actions} stacks=${info.stacks.join(",")}`,
            );
          }
        },
  });

  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
