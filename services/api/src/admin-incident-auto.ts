/**
 * MC-102 — Best-effort auto-incidents from Command Center threshold signals.
 * Idempotent via security_incidents.auto_source_key (open rows only).
 */

import { upsertAutoIncident } from "@mozetto/database";
import type { OverviewComponentStatus } from "./admin-thresholds.js";

export type AutoIncidentSignal = {
  autoSourceKey: string;
  title: string;
  severity: "critical" | "high";
  source: string;
  runbookKey: string;
  summary: string;
  detail: Record<string, unknown>;
};

export function buildAutoIncidentSignals(input: {
  solvencyStatus: OverviewComponentStatus;
  solvencyReasons: string[];
  watchtowerSignal?: string | null;
  indexerStatus: OverviewComponentStatus;
  indexerReasons: string[];
  aiStatus: OverviewComponentStatus;
  aiReasons: string[];
}): AutoIncidentSignal[] {
  const signals: AutoIncidentSignal[] = [];

  if (input.solvencyStatus === "CRITICAL") {
    signals.push({
      autoSourceKey: "auto:overview:solvency:critical",
      title: "Protocol solvency critical",
      severity: "critical",
      source: "overview.solvency",
      runbookKey: "solvency_mismatch",
      summary: "Solvency banner or live reconciliation reports CRITICAL divergence.",
      detail: {
        componentStatus: input.solvencyStatus,
        reasons: input.solvencyReasons,
        watchtowerSignal: input.watchtowerSignal ?? null,
      },
    });
  }

  if (
    input.watchtowerSignal &&
    /fail|critical|diverg|mismatch/i.test(input.watchtowerSignal)
  ) {
    signals.push({
      autoSourceKey: "auto:overview:watchtower:critical",
      title: "Watchtower verification failure",
      severity: "critical",
      source: "overview.watchtower",
      runbookKey: "solvency_mismatch",
      summary: `Watchtower signal: ${input.watchtowerSignal}`,
      detail: {
        watchtowerSignal: input.watchtowerSignal,
        solvencyStatus: input.solvencyStatus,
      },
    });
  }

  if (input.indexerStatus === "CRITICAL" || input.indexerStatus === "STALE") {
    signals.push({
      autoSourceKey: "auto:overview:indexer:critical",
      title:
        input.indexerStatus === "STALE"
          ? "Indexer cursor stale"
          : "Indexer lag critical",
      severity: input.indexerStatus === "STALE" ? "high" : "critical",
      source: "overview.indexer",
      runbookKey: "indexer_lag",
      summary: "Indexer health exceeded MC-033 threshold on Command Center.",
      detail: {
        componentStatus: input.indexerStatus,
        reasons: input.indexerReasons,
      },
    });
  }

  if (input.aiStatus === "CRITICAL") {
    signals.push({
      autoSourceKey: "auto:overview:ai:critical",
      title: "AI provider health critical",
      severity: "high",
      source: "overview.ai",
      runbookKey: "ai_provider_outage",
      summary: "Agent fallback rate or p95 latency exceeded critical thresholds.",
      detail: {
        componentStatus: input.aiStatus,
        reasons: input.aiReasons,
      },
    });
  }

  return signals;
}

export async function syncAutoIncidentsFromOverview(input: {
  solvencyStatus: OverviewComponentStatus;
  solvencyReasons: string[];
  watchtowerSignal?: string | null;
  indexerStatus: OverviewComponentStatus;
  indexerReasons: string[];
  aiStatus: OverviewComponentStatus;
  aiReasons: string[];
}): Promise<{ attempted: number; created: number; errors: string[] }> {
  const signals = buildAutoIncidentSignals(input);
  let created = 0;
  const errors: string[] = [];

  for (const signal of signals) {
    try {
      const result = await upsertAutoIncident({
        autoSourceKey: signal.autoSourceKey,
        title: signal.title,
        severity: signal.severity,
        source: signal.source,
        runbookKey: signal.runbookKey,
        summary: signal.summary,
        detail: signal.detail,
      });
      if (result.created) created += 1;
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  return { attempted: signals.length, created, errors };
}
