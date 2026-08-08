/**
 * MC-103 — Control incident runbook catalog (Plan 11 §4).
 * Linked from incident detail; no secret values.
 */

export type IncidentRunbook = {
  key: string;
  title: string;
  severityHint: string;
  summary: string;
  steps: string[];
  docAnchor: string;
};

export const INCIDENT_RUNBOOKS: Record<string, IncidentRunbook> = {
  solvency_mismatch: {
    key: "solvency_mismatch",
    title: "Solvency mismatch",
    severityHint: "SEV0",
    summary: "Vault ↔ mirror divergence or watchtower failure — player funds at risk.",
    docAnchor: "solvency-mismatch",
    steps: [
      "Automatically pause new on-chain matchmaking.",
      "Preserve active session state.",
      "Snapshot reconciliation sources.",
      "Compare chain vs indexer vs DB.",
      "Run independent watchtower/reconciliation.",
      "Open SEV0 — do not perform manual ledger credit/debit.",
      "Escalate to protocol/governance recovery if required.",
    ],
  },
  settlement_backlog: {
    key: "settlement_backlog",
    title: "Settlement backlog",
    severityHint: "SEV1",
    summary: "Settlement queue age or failure count exceeds policy.",
    docAnchor: "settlement-backlog",
    steps: [
      "Inspect worker health.",
      "Inspect attestor quorum.",
      "Inspect RPC/gas.",
      "Retry idempotently.",
      "Drain new exposure if age threshold exceeded.",
      "Surface user settling balances honestly.",
    ],
  },
  vrf_stalled: {
    key: "vrf_stalled",
    title: "VRF stalled",
    severityHint: "SEV1",
    summary: "Randomness fulfillment pending beyond policy window.",
    docAnchor: "vrf-stalled",
    steps: [
      "Stop opening sessions that require a new randomness epoch.",
      "Allow already-ready hands/sessions according to protocol.",
      "Inspect subscription/funding/request confirmations.",
      "Do not reroll randomness.",
    ],
  },
  ai_provider_outage: {
    key: "ai_provider_outage",
    title: "AI provider outage",
    severityHint: "SEV1",
    summary: "Agent fallback spike or latency SLO breach.",
    docAnchor: "ai-provider-outage",
    steps: [
      "Mark provider degraded.",
      "Deterministic fallback according to policy.",
      "Stop new AI tables if fallback quality/risk threshold exceeded.",
      "Preserve current hand integrity.",
    ],
  },
  indexer_lag: {
    key: "indexer_lag",
    title: "Indexer lag / stale cursor",
    severityHint: "SEV1",
    summary: "Chain cursor stale or block lag beyond critical threshold.",
    docAnchor: "indexer-lag",
    steps: [
      "Verify indexer worker health and RPC connectivity.",
      "Compare RPC head vs chain_cursors.last_block.",
      "Pause dependent on-chain flows if lag is critical.",
      "Do not mutate balances from Control — reconcile only.",
    ],
  },
  game_server_crash: {
    key: "game_server_crash",
    title: "Game server crash",
    severityHint: "SEV1",
    summary: "Game actor lease loss or session reconstruction failure.",
    docAnchor: "game-server-crash",
    steps: [
      "Actor lease reclaim.",
      "Replay durable events.",
      "Validate hash tip.",
      "Resume only if state reconstruction passes.",
    ],
  },
};

export function getRunbook(key: string | null | undefined): IncidentRunbook | null {
  if (!key) return null;
  return INCIDENT_RUNBOOKS[key] ?? null;
}

export function severityToSevLabel(severity: string): string {
  switch (severity) {
    case "critical":
      return "SEV0";
    case "high":
      return "SEV1";
    case "warning":
      return "SEV2";
    default:
      return "SEV3";
  }
}

export function sevLabelToSeverity(sev: string): "critical" | "high" | "warning" | "info" {
  const normalized = sev.trim().toUpperCase();
  if (normalized === "SEV0") return "critical";
  if (normalized === "SEV1") return "high";
  if (normalized === "SEV2") return "warning";
  return "info";
}
