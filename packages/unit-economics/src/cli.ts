#!/usr/bin/env node
/**
 * WP-111 — per-hand / per-session cost report CLI.
 *
 * Usage:
 *   pnpm --filter @mozetto/unit-economics report:cost -- --demo
 *   pnpm --filter @mozetto/unit-economics report:cost -- --ledger path.jsonl
 *   pnpm --filter @mozetto/unit-economics report:cost -- --session s1 --ledger path.jsonl
 *   pnpm economics:report -- --demo
 *
 * Ledger lines: JSON objects with sessionId, handId, rakeRevenue, and either
 * decisions[{promptTokens,completionTokens,...}] or tokenUsage / aiCogsUsdMicro.
 */

import { readFileSync, existsSync } from "node:fs";
import {
  buildHandCostReport,
  buildSessionCostReport,
  serializeSessionCostReport,
  type HandCostInput,
} from "./hand-cost.js";
import { placeholdersFromEnv } from "./pricing.js";

function argValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  return args[i + 1];
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

function parseLedgerLine(raw: unknown, placeholders: ReturnType<typeof placeholdersFromEnv>): HandCostInput | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const sessionId = String(o.sessionId ?? o.session_id ?? "");
  const handId = String(o.handId ?? o.hand_id ?? "");
  if (!sessionId || !handId) return null;

  const rakeRaw = o.rakeRevenue ?? o.rake_revenue ?? o.rake ?? 0;
  let rakeRevenue = 0n;
  try {
    rakeRevenue = BigInt(String(rakeRaw));
  } catch {
    rakeRevenue = 0n;
  }

  const decisions = Array.isArray(o.decisions)
    ? o.decisions.map((d) => {
        const row = d as Record<string, unknown>;
        return {
          seat: Number(row.seat ?? 0),
          profileKey: row.profileKey != null ? String(row.profileKey) : undefined,
          promptTokens: Number(row.promptTokens ?? row.prompt_tokens ?? 0),
          completionTokens: Number(row.completionTokens ?? row.completion_tokens ?? 0),
          aiCogsUsdMicro:
            row.aiCogsUsdMicro != null ? BigInt(String(row.aiCogsUsdMicro)) : undefined,
          energyDebited: row.energyDebited != null ? Number(row.energyDebited) : undefined,
          fallbackUsed: Boolean(row.fallbackUsed),
          providerLatencyMs:
            row.providerLatencyMs != null ? Number(row.providerLatencyMs) : undefined,
          modelId: row.modelId != null ? String(row.modelId) : undefined,
        };
      })
    : undefined;

  let tokenUsage: HandCostInput["tokenUsage"];
  if (o.tokenUsage && typeof o.tokenUsage === "object") {
    const t = o.tokenUsage as Record<string, unknown>;
    tokenUsage = {
      promptTokens: Number(t.promptTokens ?? t.prompt_tokens ?? 0),
      completionTokens: Number(t.completionTokens ?? t.completion_tokens ?? 0),
    };
  }

  return {
    sessionId,
    handId,
    rakeRevenue,
    decisions,
    tokenUsage,
    aiCogsUsdMicro: o.aiCogsUsdMicro != null ? BigInt(String(o.aiCogsUsdMicro)) : undefined,
    placeholders,
    league: o.league != null ? String(o.league) : null,
    atMs: o.atMs != null ? Number(o.atMs) : undefined,
    applyPlaceholders: o.applyPlaceholders !== false,
  };
}

function demoHands(): HandCostInput[] {
  const ph = placeholdersFromEnv();
  return [
    {
      sessionId: "demo-session",
      handId: "hand-1",
      rakeRevenue: 50_000n, // $0.05 USDC raw (6 decimals) or accounting units
      decisions: [
        {
          seat: 0,
          profileKey: "shark",
          promptTokens: 2_400,
          completionTokens: 80,
          energyDebited: 12,
          fallbackUsed: false,
          providerLatencyMs: 420,
        },
        {
          seat: 1,
          profileKey: "machine",
          promptTokens: 2_100,
          completionTokens: 64,
          energyDebited: 10,
          fallbackUsed: false,
          providerLatencyMs: 380,
        },
      ],
      placeholders: ph,
      league: "bronze",
    },
    {
      sessionId: "demo-session",
      handId: "hand-2",
      rakeRevenue: 80_000n,
      decisions: [
        {
          seat: 0,
          profileKey: "shark",
          promptTokens: 3_000,
          completionTokens: 120,
          energyDebited: 15,
          fallbackUsed: true,
          providerLatencyMs: 900,
        },
      ],
      placeholders: ph,
      league: "bronze",
    },
  ];
}

function main(): void {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  if (hasFlag(args, "--help") || hasFlag(args, "-h")) {
    console.log(`WP-111 economics cost report

Options:
  --demo                 Emit a sample session report (hypotheses)
  --ledger <path>        Read JSONL hand ledger
  --session <id>         Filter ledger to one session
  --hand <id>            Single-hand report (requires --ledger or --demo)
  --no-placeholders      Zero chain/VRF/relayer/cloud placeholders
  --json                 Pretty JSON on stdout (default)
`);
    process.exit(0);
  }

  const placeholders = placeholdersFromEnv();
  const noPh = hasFlag(args, "--no-placeholders");
  const sessionFilter = argValue(args, "--session");
  const handFilter = argValue(args, "--hand");
  const ledgerPath = argValue(args, "--ledger");

  let inputs: HandCostInput[] = [];

  if (hasFlag(args, "--demo") || (!ledgerPath && !hasFlag(args, "--ledger"))) {
    if (!ledgerPath) {
      inputs = demoHands();
    }
  }

  if (ledgerPath) {
    if (!existsSync(ledgerPath)) {
      console.error(`ledger not found: ${ledgerPath}`);
      process.exit(1);
    }
    const text = readFileSync(ledgerPath, "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        continue;
      }
      const hand = parseLedgerLine(parsed, placeholders);
      if (!hand) continue;
      if (sessionFilter && hand.sessionId !== sessionFilter) continue;
      if (handFilter && hand.handId !== handFilter) continue;
      if (noPh) hand.applyPlaceholders = false;
      inputs.push(hand);
    }
  }

  if (hasFlag(args, "--demo") && ledgerPath == null) {
    inputs = demoHands().map((h) => ({
      ...h,
      applyPlaceholders: noPh ? false : h.applyPlaceholders,
    }));
  }

  if (!inputs.length) {
    console.error("No hand records — use --demo or --ledger <jsonl>");
    process.exit(1);
  }

  if (handFilter && inputs.length === 1) {
    const report = buildHandCostReport(inputs[0]!);
    const session = buildSessionCostReport({ hands: [report], sessionId: report.sessionId });
    console.log(JSON.stringify(serializeSessionCostReport(session), null, 2));
    return;
  }

  const session = buildSessionCostReport({
    hands: inputs,
    sessionId: sessionFilter ?? inputs[0]?.sessionId ?? null,
  });
  console.log(JSON.stringify(serializeSessionCostReport(session), null, 2));
}

main();
