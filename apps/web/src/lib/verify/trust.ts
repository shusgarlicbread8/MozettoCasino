/**
 * WP-128 — consumer trust badge state derived from public verify (WP-090).
 * Presentation only; does not invent protocol fields.
 */

import type { ComponentStatus, PublicVerifyStatus, VerifySessionPayload } from "./types";

export type TrustPillId = "funds" | "players" | "cards";

export type TrustPill = {
  id: TrustPillId;
  label: string;
  status: ComponentStatus;
};

export type TrustDetailRow = {
  id: string;
  label: string;
  status: ComponentStatus;
  detail: string;
};

export type TrustPhase = "live" | "settled" | "unknown";

export function isGameVerified(result?: PublicVerifyStatus | null): boolean {
  return result === "VERIFIED" || result === "VERIFIED_WITH_ATTESTED_PRIVATE_DEALER";
}

export function verifyHref(sessionId: string | null | undefined): string | null {
  if (!sessionId) return null;
  return `/verify/${encodeURIComponent(sessionId)}`;
}

function statusFromComponents(
  components: VerifySessionPayload["components"] | undefined,
  keys: (keyof NonNullable<VerifySessionPayload["components"]>)[],
): ComponentStatus {
  if (!components) return "pending";
  const vals = keys.map((k) => components[k]).filter(Boolean) as ComponentStatus[];
  if (vals.length === 0) return "pending";
  if (vals.some((v) => v === "failed")) return "failed";
  if (vals.every((v) => v === "ok")) return "ok";
  if (vals.some((v) => v === "pending" || v === "missing")) {
    return vals.some((v) => v === "pending") ? "pending" : "missing";
  }
  return "pending";
}

/** Compact in-play pills: Funds secured / Players sealed / Cards committed */
export function deriveTrustPills(payload?: Pick<VerifySessionPayload, "components" | "players" | "sessionStatus"> | null): TrustPill[] {
  const funds = statusFromComponents(payload?.components, ["session", "baseAnchor"]);
  // Sealed participant list is authoritative — a bust mid-match must not flip
  // "Players sealed" back to pending for one viewer while the other still sees ok.
  const players: ComponentStatus =
    payload?.players && payload.players.length >= 2
      ? "ok"
      : payload?.sessionStatus === "opened" ||
          payload?.sessionStatus === "playing" ||
          payload?.sessionStatus === "settling"
        ? "pending"
        : statusFromComponents(payload?.components, ["session"]);
  const cards = statusFromComponents(payload?.components, ["dealerCommitment", "vrf"]);

  return [
    { id: "funds", label: "Funds secured", status: funds === "ok" ? "ok" : funds === "missing" ? "pending" : funds },
    { id: "players", label: "Players sealed", status: players },
    { id: "cards", label: "Cards committed", status: cards },
  ];
}

/** Expanded BASE VERIFIED checklist (Plan 20A Verification UX). */
export function deriveTrustDetails(payload?: VerifySessionPayload | null): TrustDetailRow[] {
  const c = payload?.components;
  const vrfOk = c?.vrf === "ok";
  const vrfPending = !vrfOk && (c?.vrf === "pending" || !c?.vrf);
  const settled = Boolean(payload?.settledAt) || c?.settlement === "ok";

  return [
    {
      id: "funds",
      label: "Funds locked on Base",
      status: statusFromComponents(c, ["session", "baseAnchor"]),
      detail: payload?.openTxHash ? "Vault open tx recorded" : "Waiting for open / seal",
    },
    {
      id: "players",
      label: "Players sealed",
      status:
        payload?.players && payload.players.length >= 2
          ? "ok"
          : payload?.sessionStatus
            ? "pending"
            : "missing",
      detail:
        payload?.players && payload.players.length
          ? `${payload.players.length} sealed seat${payload.players.length === 1 ? "" : "s"}`
          : "Seats not yet published",
    },
    {
      id: "vrf",
      label: vrfOk ? "VRF fulfilled" : vrfPending ? "VRF requested" : "VRF",
      status: c?.vrf ?? "pending",
      detail:
        payload?.vrf?.[0]?.status != null
          ? String(payload.vrf[0].status)
          : "Randomness epoch not published",
    },
    {
      id: "deck",
      label: "Deck batch committed",
      status: c?.dealerCommitment ?? "pending",
      detail: payload?.hashes?.dealerRoot || payload?.dealerCommitment?.dealer_root || "Dealer root pending",
    },
    {
      id: "events",
      label: "Events anchored",
      status: statusFromComponents(c, ["eventRoots", "baseAnchor"]),
      detail: payload?.hashes?.lastEventRoot || "Event root pending",
    },
    {
      id: "settlement",
      label: settled ? "Settlement confirmed" : "Settlement pending",
      status: c?.settlement ?? (settled ? "ok" : "pending"),
      detail: payload?.settlement?.txHash
        ? "Settlement tx published"
        : payload?.settlement?.proposalStatus || "Awaiting proposal",
    },
  ];
}

export function deriveTrustPhase(payload?: VerifySessionPayload | null): TrustPhase {
  if (!payload) return "unknown";
  if (isGameVerified(payload.result) || payload.status === "verified" || Boolean(payload.settledAt)) {
    return "settled";
  }
  if (payload.sessionStatus === "settled" || payload.sessionStatus === "settling") return "settled";
  return "live";
}
