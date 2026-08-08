import Link from "next/link";
import { adminFetch } from "@/lib/api";
import { ControlPageHeader } from "../../components/control/ControlPageHeader";
import { ControlTable } from "../../components/control/ControlTable";

type PlayerRow = {
  profileId: string;
  handle: string;
  displayName: string;
  wallet: string | null;
  arenaAccount: string | null;
  currentAvailable: { usdMicro: string | null };
  sessionNet: { usdMicro: string | null };
  rakeContributed: { usdMicro: string | null };
  hands: number;
  sessions: number;
  rating: number | null;
  lastActiveAt: string | null;
};

type PlayersResponse = {
  players: PlayerRow[];
  meta?: { search?: string | null; count?: number };
};

function microToUsd(raw: string | null | undefined): string {
  if (raw == null || raw === "") return "—";
  try {
    const n = Number(BigInt(raw)) / 1_000_000;
    return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });
  } catch {
    return "—";
  }
}

function shortAddr(addr: string | null): string {
  if (!addr) return "—";
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export default async function PlayersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const query = q ? `?search=${encodeURIComponent(q)}&limit=100` : "?limit=100";

  let data: PlayersResponse | null = null;
  let error: string | null = null;
  try {
    data = await adminFetch<PlayersResponse>(`/v1/admin/players${query}`);
  } catch (e) {
    error = e instanceof Error ? e.message : "fetch failed";
  }

  const players = data?.players ?? [];

  return (
    <div>
      <ControlPageHeader
        title="Players"
        description="Wallet/profile dossiers, P&L projections, funding summary. No live hole cards. No balance edits."
        status={error ? "UNAVAILABLE" : "HEALTHY"}
      />

      <form method="get" className="ctrl-search-row" style={{ marginBottom: 16 }}>
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search handle, wallet, profile id…"
          className="ctrl-input"
          style={{ minWidth: 280 }}
        />
        <button type="submit" className="ctrl-btn">
          Search
        </button>
      </form>

      {error ? <div className="card badge-err text-sm" style={{ marginBottom: 16 }}>{error}</div> : null}

      <ControlTable
        columns={[
          {
            key: "handle",
            header: "Handle",
            render: (r) => (
              <Link href={`/players/${r.profileId}`}>{r.handle}</Link>
            ),
          },
          { key: "display", header: "Name", render: (r) => r.displayName },
          {
            key: "wallet",
            header: "Wallet",
            mono: true,
            render: (r) => (
              <span title={r.wallet ?? undefined}>{shortAddr(r.wallet)}</span>
            ),
          },
          {
            key: "available",
            header: "Available",
            render: (r) => microToUsd(r.currentAvailable.usdMicro),
          },
          {
            key: "sessionNet",
            header: "Session net",
            render: (r) => microToUsd(r.sessionNet.usdMicro),
          },
          {
            key: "rake",
            header: "Rake contrib.",
            render: (r) => microToUsd(r.rakeContributed.usdMicro),
          },
          { key: "hands", header: "Hands", render: (r) => r.hands.toLocaleString() },
          { key: "sessions", header: "Sessions", render: (r) => r.sessions.toLocaleString() },
          {
            key: "rating",
            header: "Rating",
            render: (r) => (r.rating != null ? Math.round(r.rating).toLocaleString() : "—"),
          },
          {
            key: "active",
            header: "Last active",
            render: (r) =>
              r.lastActiveAt
                ? new Date(r.lastActiveAt).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })
                : "—",
          },
        ]}
        rows={players}
        rowKey={(r) => r.profileId}
        empty={q ? "No players match search" : "No players yet"}
        error={error}
        onRowClick={undefined}
      />

      <div className="ctrl-stub-note" style={{ marginTop: 16 }}>
        Balances are reporting projections — not authoritative. Integrity / restrictions in Wave C5.
      </div>
    </div>
  );
}
