import Link from "next/link";
import { adminFetch } from "@/lib/api";
import { ControlPageHeader } from "../../components/control/ControlPageHeader";
import { ControlTable } from "../../components/control/ControlTable";

type RiskOverview = {
  restrictedPlayers: Array<{
    profileId: string;
    handle: string;
    displayName: string;
    restrictNewMatchmaking: boolean;
    underReview: boolean;
    requireIntegrityReview: boolean;
    updatedAt: string | null;
  }>;
  openCollusionSignals: { available: boolean; count: number | null };
  adminPlayerOps: { available: boolean; status?: string };
  generatedAt: string;
};

function flagSummary(p: RiskOverview["restrictedPlayers"][0]) {
  const flags: string[] = [];
  if (p.restrictNewMatchmaking) flags.push("MM blocked");
  if (p.underReview) flags.push("Under review");
  if (p.requireIntegrityReview) flags.push("Integrity review");
  return flags.join(" · ") || "—";
}

export default async function RiskPage() {
  let overview: RiskOverview | null = null;
  let error: string | null = null;
  try {
    overview = await adminFetch<RiskOverview>("/v1/admin/risk/overview");
  } catch (e) {
    error = e instanceof Error ? e.message : "fetch failed";
  }

  return (
    <div>
      <ControlPageHeader
        title="Risk & Integrity"
        description="Pair caps, linked accounts, rat-hole, collusion signals. Restrict new matchmaking only — never edit balances."
        status={error ? "UNAVAILABLE" : "HEALTHY"}
      />

      {error ? <div className="card badge-err text-sm" style={{ marginBottom: 16 }}>{error}</div> : null}

      {overview ? (
        <>
          <div className="ctrl-metric-grid" style={{ marginBottom: 24 }}>
            <div className="ctrl-stub-note">
              Flagged players: {overview.restrictedPlayers.length}
            </div>
            <div className="ctrl-stub-note">
              Open collusion signals:{" "}
              {overview.openCollusionSignals.available
                ? overview.openCollusionSignals.count ?? 0
                : "UNAVAILABLE"}
            </div>
            <div className="ctrl-stub-note">
              Admin player ops:{" "}
              {overview.adminPlayerOps.available ? "available" : "UNAVAILABLE (migration 039)"}
            </div>
          </div>

          <h2 className="ctrl-section-title">Players with active restrictions</h2>
          <ControlTable
            columns={[
              {
                key: "player",
                header: "Player",
                render: (r) => (
                  <Link href={`/players/${encodeURIComponent(r.profileId)}`}>
                    @{r.handle}
                  </Link>
                ),
              },
              { key: "name", header: "Display", render: (r) => r.displayName },
              { key: "flags", header: "Flags", render: (r) => flagSummary(r) },
              {
                key: "updated",
                header: "Updated",
                render: (r) =>
                  r.updatedAt
                    ? new Date(r.updatedAt).toLocaleString(undefined, {
                        dateStyle: "short",
                        timeStyle: "short",
                      })
                    : "—",
              },
            ]}
            rows={overview.restrictedPlayers}
            rowKey={(r) => r.profileId}
            empty="No players currently flagged"
          />

          <div className="ctrl-stub-note" style={{ marginTop: 16 }}>
            Open a player dossier for full integrity aggregation (pair caps, linked accounts,
            rat-hole). Wave C5 MC-050–054.
          </div>
        </>
      ) : null}
    </div>
  );
}
