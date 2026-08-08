import Link from "next/link";
import { notFound } from "next/navigation";
import { adminFetch } from "@/lib/api";
import { PlayerIntegritySection } from "../../../components/PlayerIntegritySection";
import { PlayerTimelineSection } from "../../../components/PlayerTimelineSection";
import { ControlMetricCard } from "../../../components/control/ControlMetricCard";
import { ControlPageHeader } from "../../../components/control/ControlPageHeader";
import { ControlTable } from "../../../components/control/ControlTable";
import type { ControlHealth } from "../../../components/control/types";

type Money = { usdc: string | null; usdMicro: string | null };

type PlayerDetail = {
  player: {
    profileId: string;
    handle: string;
    displayName: string;
    wallet: string | null;
    arenaAccount: string | null;
    currentAvailable: Money;
    atTables: Money;
    settling: Money;
    lifetimeDeposits: Money;
    lifetimeWithdrawals: Money;
    sessionNet: Money;
    rakeContributed: Money;
    hands: number;
    sessions: number;
    lastActiveAt: string | null;
    createdAt: string;
  };
  pnl: { note?: string };
  rating: {
    value: number | null;
    provisional: boolean | null;
    matches: number | null;
    poolId: string;
  };
  sessionsSummary: {
    total: number;
    recent: Array<{
      sessionId: string;
      status: string;
      cityId: string | null;
      cityName: string | null;
      buyIn: { usdMicro: string | null };
      rakeContributed: Money;
      handsInSession: number;
      createdAt: string;
      settledAt: string | null;
    }>;
  };
  generatedAt: string;
  privacy: { holeCardsExposed: boolean; rawCotExposed: boolean };
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

function moneyStatus(m: Money): ControlHealth {
  return m.usdMicro != null ? "HEALTHY" : "UNAVAILABLE";
}

export default async function PlayerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let detail: PlayerDetail | null = null;
  let error: string | null = null;
  try {
    detail = await adminFetch<PlayerDetail>(`/v1/admin/players/${encodeURIComponent(id)}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "fetch failed";
    if (msg.startsWith("404")) {
      notFound();
    }
    error = msg;
  }

  if (!detail && !error) notFound();

  const p = detail?.player;
  const at = detail?.generatedAt ?? new Date().toISOString();

  return (
    <div>
      <ControlPageHeader
        title={p ? `@${p.handle}` : "Player"}
        description={
          p
            ? `${p.displayName} — read-only P&L dossier. No hole cards. No balance edits.`
            : "Player detail"
        }
        status={error ? "UNAVAILABLE" : "HEALTHY"}
        actions={
          <Link href="/players" className="ctrl-btn">
            ← Players
          </Link>
        }
      />

      {error ? <div className="card badge-err text-sm" style={{ marginBottom: 16 }}>{error}</div> : null}

      {p ? (
        <>
          <div className="ctrl-stub-note" style={{ marginBottom: 16 }}>
            <span className="mono">{p.profileId}</span>
            {p.wallet ? (
              <>
                {" · "}
                Wallet <span className="mono">{p.wallet}</span>
              </>
            ) : null}
            {p.arenaAccount ? (
              <>
                {" · "}
                Arena <span className="mono">{p.arenaAccount}</span>
              </>
            ) : null}
          </div>

          <div className="ctrl-metric-grid">
            <ControlMetricCard
              label="Available"
              value={microToUsd(p.currentAvailable.usdMicro)}
              source="ledger (onchain)"
              lastUpdated={at}
              status={moneyStatus(p.currentAvailable)}
            />
            <ControlMetricCard
              label="At tables"
              value={microToUsd(p.atTables.usdMicro)}
              source="ledger escrow"
              lastUpdated={at}
              status={moneyStatus(p.atTables)}
            />
            <ControlMetricCard
              label="Settling"
              value={microToUsd(p.settling.usdMicro)}
              source="onchain_sessions"
              lastUpdated={at}
              status={moneyStatus(p.settling)}
            />
            <ControlMetricCard
              label="Lifetime deposits"
              value={microToUsd(p.lifetimeDeposits.usdMicro)}
              source="vault_deposits"
              lastUpdated={at}
              status={moneyStatus(p.lifetimeDeposits)}
            />
            <ControlMetricCard
              label="Lifetime withdrawals"
              value={microToUsd(p.lifetimeWithdrawals.usdMicro)}
              source="vault_withdrawals"
              lastUpdated={at}
              status={moneyStatus(p.lifetimeWithdrawals)}
            />
            <ControlMetricCard
              label="Session net"
              value={microToUsd(p.sessionNet.usdMicro)}
              source="account_ratings"
              lastUpdated={at}
              status={moneyStatus(p.sessionNet)}
            />
            <ControlMetricCard
              label="Rake contributed"
              value={microToUsd(p.rakeContributed.usdMicro)}
              source="balance_leaves"
              lastUpdated={at}
              status={moneyStatus(p.rakeContributed)}
            />
            <ControlMetricCard
              label="Rating"
              value={
                detail?.rating.value != null
                  ? `${Math.round(detail.rating.value)}${detail.rating.provisional ? " (P)" : ""}`
                  : "—"
              }
              source={detail?.rating.poolId ?? "account_ratings"}
              lastUpdated={at}
              status={detail?.rating.value != null ? "HEALTHY" : "UNAVAILABLE"}
            />
          </div>

          {detail?.pnl.note ? (
            <div className="ctrl-stub-note" style={{ marginTop: 16 }}>
              {detail.pnl.note}
            </div>
          ) : null}

          <section style={{ marginTop: 24 }}>
            <h2 className="ctrl-section-title">Recent sessions</h2>
            <ControlTable
              columns={[
                {
                  key: "session",
                  header: "Session",
                  mono: true,
                  render: (r) => (
                    <Link href={`/sessions/${encodeURIComponent(r.sessionId)}`}>
                      {r.sessionId.length > 16
                        ? `${r.sessionId.slice(0, 14)}…`
                        : r.sessionId}
                    </Link>
                  ),
                },
                { key: "status", header: "Status", render: (r) => r.status },
                {
                  key: "city",
                  header: "City",
                  render: (r) => r.cityName ?? r.cityId ?? "—",
                },
                {
                  key: "buyin",
                  header: "Buy-in",
                  render: (r) => microToUsd(r.buyIn.usdMicro),
                },
                {
                  key: "rake",
                  header: "Rake",
                  render: (r) => microToUsd(r.rakeContributed.usdMicro),
                },
                {
                  key: "hands",
                  header: "Hands",
                  render: (r) => r.handsInSession.toLocaleString(),
                },
                {
                  key: "created",
                  header: "Opened",
                  render: (r) =>
                    new Date(r.createdAt).toLocaleString(undefined, {
                      dateStyle: "short",
                      timeStyle: "short",
                    }),
                },
              ]}
              rows={detail?.sessionsSummary.recent ?? []}
              rowKey={(r) => r.sessionId}
              empty="No sessions"
            />
          </section>

          <PlayerIntegritySection profileId={p.profileId} canMutate />

          <PlayerTimelineSection profileId={p.profileId} />

          {detail?.privacy ? (
            <div className="ctrl-stub-note" style={{ marginTop: 16 }}>
              Privacy: hole cards {detail.privacy.holeCardsExposed ? "EXPOSED" : "hidden"} · raw CoT{" "}
              {detail.privacy.rawCotExposed ? "EXPOSED" : "hidden"}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
