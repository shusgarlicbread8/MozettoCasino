/**
 * WP-107 live-table metrics hooks (+ WP-111 token/COGS counters).
 *
 * Tracks illegal-action rate, fallback rate, Energy/hand, latency,
 * and Groq token totals when the provider reports usage.
 */

export interface LiveDecisionSample {
  sessionId: string;
  handId: string;
  seat: number;
  profileKey: string;
  fallbackUsed: boolean;
  illegalActionFallback: boolean;
  providerLatencyMs: number;
  publicCadenceMs: number;
  energyDebited: number;
  energyRemaining: number;
  modelId: string;
  atMs: number;
  /** WP-111 — prompt tokens when Groq returns usage. */
  promptTokens?: number;
  /** WP-111 — completion tokens when Groq returns usage. */
  completionTokens?: number;
}

export interface LiveTableMetricsSnapshot {
  workPacket: "WP-107";
  economicsWorkPacket: "WP-111";
  decisions: number;
  hands: number;
  fallbackCount: number;
  illegalActionCount: number;
  fallbackRate: number;
  illegalActionRate: number;
  energyDebitedTotal: number;
  energyPerHand: number;
  /** WP-111 token aggregation (0 when mock/fallback without usage). */
  tokens: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    promptTokensPerHand: number;
    completionTokensPerHand: number;
  };
  latency: {
    count: number;
    meanMs: number;
    p50Ms: number;
    p95Ms: number;
    maxMs: number;
  };
  byProfile: Record<
    string,
    {
      decisions: number;
      fallbackRate: number;
      illegalActionRate: number;
      energyDebited: number;
      promptTokens: number;
      completionTokens: number;
    }
  >;
}

export type LiveMetricsHook = {
  onDecision?(sample: LiveDecisionSample): void;
  onHandBegin?(meta: { sessionId: string; handId: string; seats: number[] }): void;
  onHandEnd?(meta: {
    sessionId: string;
    handId: string;
    energySpent: number;
    rakeRevenue?: string | null;
  }): void;
};
function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  if (sorted.length === 1) return sorted[0]!;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  const w = idx - lo;
  return sorted[lo]! * (1 - w) + sorted[hi]! * w;
}

export class LiveTableMetrics {
  private samples: LiveDecisionSample[] = [];
  private hands = 0;
  private handEnergy = new Map<string, number>();
  private hooks: LiveMetricsHook;

  constructor(hooks: LiveMetricsHook = {}) {
    this.hooks = hooks;
  }

  beginHand(meta: { sessionId: string; handId: string; seats: number[] }): void {
    this.hands += 1;
    this.handEnergy.set(`${meta.sessionId}:${meta.handId}`, 0);
    this.hooks.onHandBegin?.(meta);
  }

  recordDecision(sample: LiveDecisionSample): void {
    this.samples.push(sample);
    const key = `${sample.sessionId}:${sample.handId}`;
    this.handEnergy.set(key, (this.handEnergy.get(key) ?? 0) + sample.energyDebited);
    this.hooks.onDecision?.(sample);
  }

  endHand(meta: {
    sessionId: string;
    handId: string;
    rakeRevenue?: string | null;
  }): void {
    const key = `${meta.sessionId}:${meta.handId}`;
    const energySpent = this.handEnergy.get(key) ?? 0;
    this.hooks.onHandEnd?.({
      sessionId: meta.sessionId,
      handId: meta.handId,
      energySpent,
      rakeRevenue: meta.rakeRevenue,
    });
  }

  snapshot(): LiveTableMetricsSnapshot {
    const n = this.samples.length;
    const fallbackCount = this.samples.filter((s) => s.fallbackUsed).length;
    const illegalActionCount = this.samples.filter((s) => s.illegalActionFallback).length;
    const energyDebitedTotal = this.samples.reduce((a, s) => a + s.energyDebited, 0);
    const promptTokens = this.samples.reduce((a, s) => a + (s.promptTokens ?? 0), 0);
    const completionTokens = this.samples.reduce((a, s) => a + (s.completionTokens ?? 0), 0);
    const latencies = this.samples.map((s) => s.providerLatencyMs).sort((a, b) => a - b);
    const meanMs = n ? latencies.reduce((a, b) => a + b, 0) / n : 0;

    const byProfile: LiveTableMetricsSnapshot["byProfile"] = {};
    for (const s of this.samples) {
      const row = (byProfile[s.profileKey] ??= {
        decisions: 0,
        fallbackRate: 0,
        illegalActionRate: 0,
        energyDebited: 0,
        promptTokens: 0,
        completionTokens: 0,
      });
      row.decisions += 1;
      row.energyDebited += s.energyDebited;
      row.promptTokens += s.promptTokens ?? 0;
      row.completionTokens += s.completionTokens ?? 0;
      if (s.fallbackUsed) row.fallbackRate += 1;
      if (s.illegalActionFallback) row.illegalActionRate += 1;
    }
    for (const row of Object.values(byProfile)) {
      row.fallbackRate = row.decisions ? row.fallbackRate / row.decisions : 0;
      row.illegalActionRate = row.decisions ? row.illegalActionRate / row.decisions : 0;
    }

    return {
      workPacket: "WP-107",
      economicsWorkPacket: "WP-111",
      decisions: n,
      hands: this.hands,
      fallbackCount,
      illegalActionCount,
      fallbackRate: n ? fallbackCount / n : 0,
      illegalActionRate: n ? illegalActionCount / n : 0,
      energyDebitedTotal,
      energyPerHand: this.hands ? energyDebitedTotal / this.hands : 0,
      tokens: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        promptTokensPerHand: this.hands ? promptTokens / this.hands : 0,
        completionTokensPerHand: this.hands ? completionTokens / this.hands : 0,
      },
      latency: {
        count: n,
        meanMs,
        p50Ms: percentile(latencies, 50),
        p95Ms: percentile(latencies, 95),
        maxMs: latencies.length ? latencies[latencies.length - 1]! : 0,
      },
      byProfile,
    };
  }

  reset(): void {
    this.samples = [];
    this.hands = 0;
    this.handEnergy.clear();
  }
}
