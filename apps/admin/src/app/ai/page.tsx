import Link from "next/link";
import { adminFetch } from "@/lib/api";

type AiHealth = {
  readOnly: boolean;
  note?: string;
  windowHours: number;
  provider: string;
  health: string;
  healthReasons: string[];
  invocations: number;
  fallbacks: number;
  fallbackRate: number;
  latency: {
    avgMs: number | null;
    p50Ms: number | null;
    p95Ms: number | null;
    p99Ms: number | null;
    sampleSize: number;
  };
  tokenUsageSum: number;
  energy: { spendSum: number; spendAvg: number | null; samples: number };
  byModel: Array<{ modelId: string | null; count: number; fallbacks: number; fallbackRate: number }>;
  bySelectedMode: Array<{ selectedMode: string | null; count: number }>;
  recentFallbacks: Array<{
    id: string;
    session_id: string;
    model_id: string | null;
    legal_action: string | null;
    latency_ms: number | null;
    created_at: string;
  }>;
};

function healthClass(h: string): string {
  if (h === "ok") return "badge-ok";
  if (h === "degraded" || h === "unknown") return "badge-warn";
  return "badge-err";
}

function fmtMs(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${Math.round(n)}ms`;
}

function pct(n: number): string {
  return `${(n * 100).toFixed(2)}%`;
}

export default async function AiHealthPage() {
  let data: AiHealth | null = null;
  let error: string | null = null;
  try {
    data = await adminFetch<AiHealth>("/v1/admin/ai/health?windowHours=24");
  } catch (e) {
    error = e instanceof Error ? e.message : "fetch failed";
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">AI provider health</h1>
        <p className="muted text-sm mt-1">
          Groq latency, fallback rate, energy/token aggregates from{" "}
          <code>agent_invocations</code>. Read-only — provider keys never leave the API.
        </p>
      </div>
      {error && <div className="card badge-err text-sm">{error}</div>}
      {data?.note && <p className="muted text-xs">{data.note}</p>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card">
          <div className="muted text-xs uppercase mb-1">Health ({data?.windowHours ?? 24}h)</div>
          <div className={`text-2xl ${healthClass(data?.health ?? "unknown")}`}>
            {data?.health ?? "—"}
          </div>
          <div className="muted text-xs mt-1">{(data?.healthReasons ?? []).join(", ")}</div>
        </div>
        <div className="card">
          <div className="muted text-xs uppercase mb-1">Invocations</div>
          <div className="text-2xl">{data?.invocations ?? "—"}</div>
        </div>
        <div className="card">
          <div className="muted text-xs uppercase mb-1">Fallback rate</div>
          <div className="text-2xl">{data ? pct(data.fallbackRate) : "—"}</div>
          <div className="muted text-xs mt-1">{data?.fallbacks ?? 0} fallbacks</div>
        </div>
        <div className="card">
          <div className="muted text-xs uppercase mb-1">Provider</div>
          <div className="text-2xl">{data?.provider ?? "groq"}</div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card">
          <div className="muted text-xs uppercase mb-1">p50 latency</div>
          <div className="text-xl">{fmtMs(data?.latency.p50Ms)}</div>
        </div>
        <div className="card">
          <div className="muted text-xs uppercase mb-1">p95 latency</div>
          <div className="text-xl">{fmtMs(data?.latency.p95Ms)}</div>
        </div>
        <div className="card">
          <div className="muted text-xs uppercase mb-1">p99 latency</div>
          <div className="text-xl">{fmtMs(data?.latency.p99Ms)}</div>
        </div>
        <div className="card">
          <div className="muted text-xs uppercase mb-1">avg latency</div>
          <div className="text-xl">{fmtMs(data?.latency.avgMs)}</div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="card">
          <div className="muted text-xs uppercase mb-1">Token usage (sum)</div>
          <div className="text-xl">{data?.tokenUsageSum ?? "—"}</div>
        </div>
        <div className="card">
          <div className="muted text-xs uppercase mb-1">Energy spend</div>
          <div className="text-xl">
            sum {data?.energy.spendSum ?? "—"}
            {data?.energy.spendAvg != null && (
              <span className="muted text-sm"> · avg {data.energy.spendAvg.toFixed(1)}</span>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card overflow-x-auto">
          <h2 className="text-sm font-semibold mb-2">By model</h2>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left muted">
                <th className="pb-2 pr-3">Model</th>
                <th className="pr-3">Count</th>
                <th>Fallback %</th>
              </tr>
            </thead>
            <tbody>
              {(data?.byModel ?? []).map((m) => (
                <tr key={String(m.modelId)} className="border-t border-[#2a2a2a]">
                  <td className="py-2 pr-3 font-mono truncate max-w-[180px]">{m.modelId}</td>
                  <td className="pr-3">{m.count}</td>
                  <td>{pct(m.fallbackRate)}</td>
                </tr>
              ))}
              {!data?.byModel.length && (
                <tr>
                  <td colSpan={3} className="py-3 muted">
                    No invocations in window.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="card overflow-x-auto">
          <h2 className="text-sm font-semibold mb-2">Selected mode mix</h2>
          <ul className="text-xs space-y-1">
            {(data?.bySelectedMode ?? []).map((m) => (
              <li key={String(m.selectedMode)} className="flex justify-between border-t border-[#2a2a2a] py-1">
                <span>{m.selectedMode}</span>
                <span className="muted">{m.count}</span>
              </li>
            ))}
            {!data?.bySelectedMode.length && <li className="muted">No mode data.</li>}
          </ul>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <h2 className="text-sm font-semibold mb-2">Recent fallbacks</h2>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left muted">
              <th className="pb-2 pr-3">When</th>
              <th className="pr-3">Session</th>
              <th className="pr-3">Action</th>
              <th>Latency</th>
            </tr>
          </thead>
          <tbody>
            {(data?.recentFallbacks ?? []).map((f) => (
              <tr key={f.id} className="border-t border-[#2a2a2a]">
                <td className="py-2 pr-3 muted">{new Date(f.created_at).toLocaleString()}</td>
                <td className="pr-3 font-mono truncate max-w-[140px]">
                  <Link href={`/sessions/${encodeURIComponent(f.session_id)}`}>{f.session_id}</Link>
                </td>
                <td className="pr-3">{f.legal_action ?? "—"}</td>
                <td>{fmtMs(f.latency_ms)}</td>
              </tr>
            ))}
            {!data?.recentFallbacks.length && (
              <tr>
                <td colSpan={4} className="py-3 muted">
                  No fallbacks in window.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
