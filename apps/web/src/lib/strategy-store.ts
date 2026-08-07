/**
 * WP-123 — persist preferred profile + bounded trait draft for Find Match.
 * profileKey syncs to `/v1/me/agent`; trait deltas stay client-side until the
 * API accepts typed axis envelopes (runtime already validates ±25).
 */

import {
  defaultOverridesForPreset,
  isStrategyProfileKey,
  type ConsumerTraitOverrides,
  type StrategyProfileKey,
} from "@/lib/strategy-profiles";

const STORAGE_KEY = "mz.strategy.v1";

export type StrategyDraft = {
  profileKey: StrategyProfileKey;
  traits: ConsumerTraitOverrides;
  updatedAt: string;
};

function fallbackDraft(profileKey: StrategyProfileKey = "fox"): StrategyDraft {
  return {
    profileKey,
    traits: defaultOverridesForPreset(profileKey),
    updatedAt: new Date(0).toISOString(),
  };
}

export function readStrategyDraft(preferredKey?: string | null): StrategyDraft {
  const fallbackKey = isStrategyProfileKey(preferredKey) ? preferredKey : "fox";
  if (typeof window === "undefined") return fallbackDraft(fallbackKey);

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallbackDraft(fallbackKey);
    const parsed = JSON.parse(raw) as Partial<StrategyDraft>;
    const key = isStrategyProfileKey(parsed.profileKey) ? parsed.profileKey : fallbackKey;
    const base = defaultOverridesForPreset(key);
    const traits = { ...base, ...(parsed.traits ?? {}) };
    return {
      profileKey: key,
      traits,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
    };
  } catch {
    return fallbackDraft(fallbackKey);
  }
}

export function writeStrategyDraft(draft: Omit<StrategyDraft, "updatedAt">): StrategyDraft {
  const next: StrategyDraft = {
    profileKey: draft.profileKey,
    traits: draft.traits,
    updatedAt: new Date().toISOString(),
  };
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }
  return next;
}

export function readPreferredProfileKey(preferredKey?: string | null): StrategyProfileKey {
  return readStrategyDraft(preferredKey).profileKey;
}
