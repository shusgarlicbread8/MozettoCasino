/** Mozetto Control capability tiers (Plan 10 §2). */
export type ControlCapabilityTier = "read" | "soft" | "runtime" | "governed" | "emergency";

export const CAPABILITY_TIER_META: Record<
  ControlCapabilityTier,
  { label: string; short: string; description: string }
> = {
  read: {
    label: "Read",
    short: "T0",
    description: "No confirmation beyond auth.",
  },
  soft: {
    label: "Soft",
    short: "T1",
    description: "Review metadata — reason + audit.",
  },
  runtime: {
    label: "Runtime",
    short: "T2",
    description: "Exposure controls — capability, reason, impact preview, audit.",
  },
  governed: {
    label: "Governed",
    short: "T3",
    description: "Protocol mutation — proposal → Safe / timelock only.",
  },
  emergency: {
    label: "Emergency",
    short: "T4",
    description: "Dedicated guardian path — separate credential.",
  },
};

/** Player restriction / replay actions map to soft ops (Tier 1). */
export const PLAYER_OPS_TIER: ControlCapabilityTier = "soft";

/** Governance proposal builder is Tier 3. */
export const GOVERNANCE_TIER: ControlCapabilityTier = "governed";

/** Principal disable / session revoke is Tier 2 runtime (high privilege). */
export const PRINCIPAL_OPS_TIER: ControlCapabilityTier = "runtime";
