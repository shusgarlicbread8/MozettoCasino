"use client";

import { useRouter } from "next/navigation";
import { ControlDangerAction } from "./control/ControlDangerAction";
import { adminFetch } from "@/lib/api";

type PlayerOps = {
  restrictNewMatchmaking: boolean;
  underReview: boolean;
  requireIntegrityReview: boolean;
};

const RESTRICTION_ACTIONS: Array<{
  action: string;
  label: string;
  summary: string;
  expectedEffect: string;
  active?: (ops: PlayerOps) => boolean;
}> = [
  {
    action: "restrict_new_matchmaking",
    label: "Restrict new matchmaking",
    summary: "Block new ranked allocations after current session boundaries.",
    expectedEffect: "Player cannot enter new ranked matchmaking until cleared.",
    active: (o) => !o.restrictNewMatchmaking,
  },
  {
    action: "clear_restrict_new_matchmaking",
    label: "Clear matchmaking restriction",
    summary: "Remove ranked matchmaking block.",
    expectedEffect: "Player may enter ranked matchmaking again.",
    active: (o) => o.restrictNewMatchmaking,
  },
  {
    action: "mark_under_review",
    label: "Mark under review",
    summary: "Flag account for integrity review. No financial effect.",
    expectedEffect: "Review flag visible to ops; no balance change.",
    active: (o) => !o.underReview,
  },
  {
    action: "clear_under_review",
    label: "Clear under review",
    summary: "Remove under-review flag after investigation.",
    expectedEffect: "Review flag cleared.",
    active: (o) => o.underReview,
  },
  {
    action: "require_integrity_review",
    label: "Require integrity review",
    summary: "Route future ranked entry to review policy when supported.",
    expectedEffect: "Integrity review required on next ranked entry attempt.",
    active: (o) => !o.requireIntegrityReview,
  },
  {
    action: "clear_integrity_review",
    label: "Clear integrity review",
    summary: "Remove integrity-review routing requirement.",
    expectedEffect: "Normal ranked entry routing.",
    active: (o) => o.requireIntegrityReview,
  },
  {
    action: "clear_review",
    label: "Clear all review flags",
    summary: "Clear matchmaking restriction and all review flags at once.",
    expectedEffect: "All admin player ops flags reset.",
    active: (o) =>
      o.restrictNewMatchmaking || o.underReview || o.requireIntegrityReview,
  },
];

export function PlayerRestrictionsActions({
  profileId,
  initialOps,
  canMutate = true,
}: {
  profileId: string;
  initialOps: PlayerOps;
  canMutate?: boolean;
}) {
  const router = useRouter();

  async function run(action: string, reason: string) {
    await adminFetch(`/v1/admin/players/${encodeURIComponent(profileId)}/restrictions`, {
      method: "POST",
      body: JSON.stringify({ action, reason }),
    });
    router.refresh();
  }

  async function requestReplay(reason: string) {
    await adminFetch(`/v1/admin/players/${encodeURIComponent(profileId)}/request-replay`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
    router.refresh();
  }

  return (
    <div className="ctrl-danger-group">
      <p className="muted text-xs">
        Privileged player ops — matchmaking / review flags only. Never edits balances.
      </p>
      <div className="flex flex-wrap gap-2">
        {RESTRICTION_ACTIONS.filter((a) => !a.active || a.active(initialOps)).map((a) => (
          <ControlDangerAction
            key={a.action}
            label={a.label}
            summary={a.summary}
            expectedEffect={a.expectedEffect}
            disabled={!canMutate}
            onConfirm={(reason) => run(a.action, reason)}
          />
        ))}
        <ControlDangerAction
          label="Request replay (latest session)"
          summary="Flag the player's most recent session for replay verification."
          expectedEffect="Session replay_requested flag set; verifier may attach result."
          disabled={!canMutate}
          onConfirm={requestReplay}
        />
      </div>
    </div>
  );
}
