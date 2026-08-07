import type { ComponentStatus, PublicVerifyStatus } from "./types";

export const RESULT_COPY: Record<
  PublicVerifyStatus,
  { label: string; tone: "ok" | "warn" | "bad" | "muted"; blurb: string }
> = {
  VERIFIED: {
    label: "Verified",
    tone: "ok",
    blurb: "Settlement and Base anchors are present for the public roots we can check.",
  },
  VERIFIED_WITH_ATTESTED_PRIVATE_DEALER: {
    label: "Verified · attested dealer",
    tone: "ok",
    blurb:
      "Public roots, VRF, and settlement check out. Hole-card material remains enclave-attested until openings are published.",
  },
  PENDING_BASE_ANCHOR: {
    label: "Pending Base anchor",
    tone: "warn",
    blurb: "Event/balance roots exist off-chain; checkpoint transaction(s) not yet confirmed.",
  },
  PENDING_SETTLEMENT: {
    label: "Pending settlement",
    tone: "warn",
    blurb: "A settlement proposal is in flight or awaiting attestors / chain submit.",
  },
  INCOMPLETE_PUBLIC_DATA: {
    label: "Incomplete public data",
    tone: "muted",
    blurb: "Not enough published roots, VRF, or settlement artifacts to claim verification.",
  },
  VERIFICATION_FAILED: {
    label: "Verification failed",
    tone: "bad",
    blurb: "An independent check rejected this transcript or digest.",
  },
};

export const COMPONENT_LABELS: Record<keyof import("./types").VerifyComponents, string> = {
  session: "Session",
  dealerCommitment: "Dealer commitment",
  vrf: "VRF",
  eventRoots: "Event roots",
  handRoots: "Hand roots",
  baseAnchor: "Base anchor",
  settlement: "Settlement",
  attestors: "Attestors",
  proofBatchInclusion: "Proof-batch inclusion",
};

export function toneClasses(tone: "ok" | "warn" | "bad" | "muted") {
  switch (tone) {
    case "ok":
      return "bg-emerald-900/40 text-emerald-400 border-emerald-800/50";
    case "warn":
      return "bg-amber-900/40 text-amber-400 border-amber-800/50";
    case "bad":
      return "bg-red-900/40 text-red-400 border-red-800/50";
    default:
      return "bg-white/[0.04] text-[#8A8A8A] border-white/[0.08]";
  }
}

export function componentTone(s: ComponentStatus): "ok" | "warn" | "bad" | "muted" {
  if (s === "ok") return "ok";
  if (s === "pending") return "warn";
  if (s === "failed") return "bad";
  return "muted";
}
