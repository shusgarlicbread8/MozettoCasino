import Link from "next/link";
import { adminFetch } from "@/lib/api";
import { ControlTable } from "./control/ControlTable";
import { PlayerRestrictionsActions } from "./PlayerRestrictionsActions";

type IntegrityPayload = {
  reviewStatus: string;
  adminFlags: {
    available: boolean;
    restrictNewMatchmaking: boolean;
    underReview: boolean;
    requireIntegrityReview: boolean;
  };
  pairCaps: {
    available: boolean;
    capThreshold: number;
    cappedOpponents: Array<{ opponentId: string; matches24h: number }>;
  };
  linkedAccounts: {
    available: boolean;
    edges: Array<{ peerId: string; reason: string; confidence: number }>;
    exclusions: Array<{ excludedId: string; reasonCode: string }>;
  };
  ratHole: {
    available: boolean;
    exits: Array<{ cityId: string; format: string; leftAt: string }>;
  };
  collusion: { available: boolean; open: unknown[] };
  integrityCases: { available: boolean; open: unknown[] };
  signals: Array<{ kind: string; status: string; summary: string }>;
};

function statusBadge(status: string) {
  const cls =
    status === "RESTRICTED"
      ? "badge-err"
      : status === "REVIEW_REQUIRED"
        ? "badge-warn"
        : status === "SIGNAL"
          ? "badge-warn"
          : "badge-ok";
  return <span className={cls}>{status}</span>;
}

export async function PlayerIntegritySection({
  profileId,
  canMutate,
}: {
  profileId: string;
  canMutate: boolean;
}) {
  let integrity: IntegrityPayload | null = null;
  let error: string | null = null;
  try {
    integrity = await adminFetch<IntegrityPayload>(
      `/v1/admin/players/${encodeURIComponent(profileId)}/integrity`,
    );
  } catch (e) {
    error = e instanceof Error ? e.message : "integrity fetch failed";
  }

  if (error) {
    return (
      <section style={{ marginTop: 24 }}>
        <h2 className="ctrl-section-title">Integrity</h2>
        <div className="badge-err text-sm">{error}</div>
      </section>
    );
  }

  if (!integrity) return null;

  const ops = {
    restrictNewMatchmaking: integrity.adminFlags.restrictNewMatchmaking,
    underReview: integrity.adminFlags.underReview,
    requireIntegrityReview: integrity.adminFlags.requireIntegrityReview,
  };

  return (
    <section style={{ marginTop: 24 }}>
      <h2 className="ctrl-section-title">
        Integrity {statusBadge(integrity.reviewStatus)}
      </h2>

      <div className="ctrl-metric-grid" style={{ marginBottom: 16 }}>
        <div className="ctrl-stub-note">
          Pair caps:{" "}
          {integrity.pairCaps.available
            ? `${integrity.pairCaps.cappedOpponents.length} at cap (≥${integrity.pairCaps.capThreshold}/24h)`
            : "UNAVAILABLE"}
        </div>
        <div className="ctrl-stub-note">
          Linked accounts:{" "}
          {integrity.linkedAccounts.available
            ? `${integrity.linkedAccounts.edges.length} edges`
            : "UNAVAILABLE"}
        </div>
        <div className="ctrl-stub-note">
          Rat-hole exits:{" "}
          {integrity.ratHole.available ? `${integrity.ratHole.exits.length} recent` : "UNAVAILABLE"}
        </div>
        <div className="ctrl-stub-note">
          Collusion signals:{" "}
          {integrity.collusion.available
            ? `${integrity.collusion.open.length} open`
            : "UNAVAILABLE"}
        </div>
      </div>

      {integrity.signals.length > 0 ? (
        <ControlTable
          columns={[
            { key: "kind", header: "Kind", render: (r) => r.kind },
            { key: "status", header: "Status", render: (r) => r.status },
            { key: "summary", header: "Summary", render: (r) => r.summary },
          ]}
          rows={integrity.signals}
          rowKey={(r, i) => `${r.kind}:${r.summary}:${i}`}
          empty="No signals"
        />
      ) : (
        <div className="ctrl-stub-note">No integrity signals detected.</div>
      )}

      {integrity.linkedAccounts.available && integrity.linkedAccounts.edges.length > 0 ? (
        <div style={{ marginTop: 16 }}>
          <h3 className="text-sm font-semibold">Linked account edges</h3>
          <ControlTable
            columns={[
              {
                key: "peer",
                header: "Peer",
                mono: true,
                render: (r) => (
                  <Link href={`/players/${encodeURIComponent(r.peerId)}`}>
                    {r.peerId.slice(0, 8)}…
                  </Link>
                ),
              },
              { key: "reason", header: "Reason", render: (r) => r.reason },
              {
                key: "conf",
                header: "Confidence",
                render: (r) => r.confidence.toFixed(2),
              },
            ]}
            rows={integrity.linkedAccounts.edges}
            rowKey={(r) => r.peerId}
            empty="None"
          />
        </div>
      ) : null}

      <div style={{ marginTop: 24 }}>
        <h3 className="text-sm font-semibold">Support controls</h3>
        <PlayerRestrictionsActions
          profileId={profileId}
          initialOps={ops}
          canMutate={canMutate}
        />
      </div>
    </section>
  );
}
