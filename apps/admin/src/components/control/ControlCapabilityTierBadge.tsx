import {
  CAPABILITY_TIER_META,
  type ControlCapabilityTier,
} from "./capability-tiers";

export function ControlCapabilityTierBadge({
  tier,
  compact,
}: {
  tier: ControlCapabilityTier;
  compact?: boolean;
}) {
  const meta = CAPABILITY_TIER_META[tier];
  return (
    <span
      className={`ctrl-tier-badge tier-${tier}`}
      title={`${meta.short} — ${meta.description}`}
    >
      {compact ? meta.short : meta.label}
    </span>
  );
}
