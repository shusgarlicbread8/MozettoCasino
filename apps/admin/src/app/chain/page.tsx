import { adminFetch } from "@/lib/api";
import {
  ControlHealthBadge,
  ControlMetricCard,
  ControlPageHeader,
  ControlTable,
  type ControlColumn,
} from "../../components/control";
import type { ControlHealth } from "../../components/control/types";

type ChainSnapshot = {
  generatedAt: string;
  globalStatus: ControlHealth;
  network: {
    chainId: number;
    rpcChainId: number | null;
    chainIdMatch: "MATCH" | "DIVERGED" | "UNAVAILABLE";
    name: string;
    env: string;
    protocolVersion: string;
    deploymentBlock: string;
    rpcHead: string | null;
    rpcError: string | null;
    rpcHealthy: boolean;
    baseBlockLag: number | null;
    indexerHealth: string;
  };
  governance: {
    protocolSafe: string | null;
    treasurySafe: string | null;
    timelock: string | null;
  };
  manifest: {
    version: string;
    nullContractCount: number;
  };
  contracts: Array<{
    key: string;
    label: string;
    expectedAddress: string | null;
    envOverrideAddress: string | null;
    addressMatch: "MATCH" | "DIVERGED" | "UNAVAILABLE";
    liveCodeHash: string | null;
    expectedCodeHash: string | null;
    codeHashMatch: "MATCH" | "DIVERGED" | "UNAVAILABLE";
    deployed: boolean;
  }>;
  matchmakingPaused: boolean | null;
};

function matchBadge(match: "MATCH" | "DIVERGED" | "UNAVAILABLE"): ControlHealth {
  if (match === "MATCH") return "HEALTHY";
  if (match === "DIVERGED") return "DIVERGED";
  return "UNAVAILABLE";
}

function truncateHash(h: string | null): string {
  if (!h) return "UNAVAILABLE";
  return h.length > 14 ? `${h.slice(0, 10)}…${h.slice(-4)}` : h;
}

const contractColumns: ControlColumn<ChainSnapshot["contracts"][number]>[] = [
  { key: "label", header: "Contract", render: (c) => c.label },
  {
    key: "address",
    header: "Manifest",
    mono: true,
    render: (c) => c.expectedAddress ?? "UNAVAILABLE",
  },
  {
    key: "env",
    header: "Env override",
    mono: true,
    render: (c) =>
      c.envOverrideAddress ? (
        <span className={c.addressMatch === "DIVERGED" ? "badge-err" : undefined}>
          {c.envOverrideAddress}
        </span>
      ) : (
        "—"
      ),
  },
  {
    key: "addrMatch",
    header: "Address",
    render: (c) => <ControlHealthBadge status={matchBadge(c.addressMatch)} label={c.addressMatch} />,
  },
  {
    key: "code",
    header: "Code hash",
    mono: true,
    render: (c) => truncateHash(c.liveCodeHash),
  },
  {
    key: "codeMatch",
    header: "Hash cmp",
    render: (c) => <ControlHealthBadge status={matchBadge(c.codeHashMatch)} label={c.codeHashMatch} />,
  },
];

export default async function ChainPage() {
  let data: ChainSnapshot | null = null;
  let error: string | null = null;
  try {
    data = await adminFetch<ChainSnapshot>("/v1/admin/chain");
  } catch (e) {
    error = e instanceof Error ? e.message : "chain fetch failed";
  }

  return (
    <div className="space-y-6">
      <ControlPageHeader
        title="Chain"
        description="Manifest addresses, live code hashes, RPC health, indexer lag. Chain authority is external to Control."
        status={data?.globalStatus ?? "UNAVAILABLE"}
      />

      {error && <div className="card badge-err text-sm">{error}</div>}

      {data && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <ControlMetricCard
              label="RPC head"
              value={data.network.rpcHead ?? "UNAVAILABLE"}
              status={data.network.rpcHealthy ? "HEALTHY" : "UNAVAILABLE"}
              source={data.network.env}
            />
            <ControlMetricCard
              label="Base block lag"
              value={data.network.baseBlockLag != null ? `${data.network.baseBlockLag} blk` : "UNAVAILABLE"}
              status={
                data.network.baseBlockLag == null
                  ? "UNAVAILABLE"
                  : data.network.baseBlockLag > 50
                    ? "STALE"
                    : "HEALTHY"
              }
            />
            <ControlMetricCard
              label="Manifest version"
              value={data.manifest.version}
              comparison={`deploy block ${data.network.deploymentBlock}`}
              status={data.manifest.nullContractCount > 5 ? "DEGRADED" : "HEALTHY"}
            />
            <ControlMetricCard
              label="Chain ID"
              value={String(data.network.chainId)}
              comparison={
                data.network.chainIdMatch === "DIVERGED"
                  ? `RPC reports ${data.network.rpcChainId} — DIVERGED`
                  : data.network.rpcChainId != null
                    ? `RPC ${data.network.rpcChainId}`
                    : "UNAVAILABLE"
              }
              status={matchBadge(data.network.chainIdMatch)}
            />
          </div>

          {data.network.rpcError && (
            <div className="card badge-warn text-sm">RPC error: {data.network.rpcError}</div>
          )}

          <div className="card">
            <h2 className="text-sm font-semibold mb-2">Governance addresses</h2>
            <table className="w-full text-xs">
              <tbody>
                {(
                  [
                    ["Protocol Safe", data.governance.protocolSafe],
                    ["Treasury Safe", data.governance.treasurySafe],
                    ["Timelock", data.governance.timelock],
                  ] as const
                ).map(([label, addr]) => (
                  <tr key={label} className="border-t border-[#2a2a2a]">
                    <td className="py-2 muted w-40">{label}</td>
                    <td className="py-2 font-mono">{addr ?? "UNAVAILABLE"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card">
            <div className="flex items-center justify-between gap-2 mb-2">
              <h2 className="text-sm font-semibold">Contracts</h2>
              <span className="muted text-xs">
                Code hash comparison uses ADMIN_EXPECTED_*_CODE_HASH when set
              </span>
            </div>
            <ControlTable
              columns={contractColumns}
              rows={data.contracts}
              rowKey={(c) => c.key}
              stale={data.globalStatus === "STALE"}
            />
          </div>

          {data.matchmakingPaused && (
            <p className="text-xs badge-warn">On-chain matchmaking is paused.</p>
          )}
        </>
      )}
    </div>
  );
}
