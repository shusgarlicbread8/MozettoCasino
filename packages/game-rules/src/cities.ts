/**
 * Cities — the canonical stake definitions for Mozetto cash poker.
 *
 * Architectural rule this file exists to enforce:
 *
 *   The table's blind level determines how much money can enter the game.
 *   The player's bankroll does not determine the blind level.
 *
 * A city fixes its small/big blind. A player then chooses a buy-in inside the
 * city's band (40–100BB, the mainstream online-poker standard). A whale with
 * $1,000,000 sitting in a $0.50/$1 city may still only bring $100 to the felt;
 * their bankroll is irrelevant to the stack at risk. Stacks may grow past 100BB
 * — but only by winning them at the table, never by buying them.
 *
 * Cities are deliberately NOT skill tiers. Willingness to risk money says
 * nothing about ability, so stakes (economics) and Arena Rating (skill) are
 * kept as independent axes. Nothing here gates a city on rating.
 *
 * NOTE ON PERSISTENCE: the `tables.league_id` column and the on-chain seat
 * ticket still carry a city's `id`. The column name is legacy; the concept is
 * a city. Renaming the column would churn the settlement and ticket schemas
 * for no functional gain, so the id is stable and the naming is fixed here.
 *
 *   league_id ≡ cityId
 *
 * They are the same value, never a mapping. `resolveCityId` exists so a caller
 * may pass either spelling at the API boundary.
 */

import { assertChipAligned, atomsToUsdc, formatUsdc, usdcToAtoms } from "./money.js";

/** Mainstream online-poker buy-in band, in big blinds. */
export const MIN_BUY_IN_BB = 40;
export const MAX_BUY_IN_BB = 100;

export type City = {
  /** Stable id; persisted as `tables.league_id`. */
  id: string;
  /** Display name shown on the city card. */
  name: string;
  /** Flavour line for the lobby. Never a rules statement. */
  tagline: string;
  color: string;
  /** Canonical stakes, in USDC atoms. The city IS its blinds. */
  smallBlindAtoms: bigint;
  bigBlindAtoms: bigint;
  /**
   * Ranked cities feed Arena Rating and enforce a hard HU pair-cap; Casual
   * does neither. This is a property of the MODE, not of the price — Porto is
   * Casual because Casual is what it is for, not because it is the cheapest.
   */
  rated: boolean;
  /** Lobby ordering, cheapest first. */
  sortOrder: number;
};

/**
 * The Season 1 ladder. Blind levels are the canonical value; buy-ins are
 * always derived as 40–100BB, so a city never needs a separate buy-in field.
 */
export const CITIES: readonly City[] = [
  {
    id: "casual",
    name: "Porto",
    tagline: "Casual mode — real stakes, no Arena Rating on the line.",
    color: "#9AA88A",
    smallBlindAtoms: usdcToAtoms(0.25),
    bigBlindAtoms: usdcToAtoms(0.5),
    rated: false,
    sortOrder: 0,
  },
  {
    id: "bronze",
    name: "Berlin",
    tagline: "Ranked play starts here. Where most agents cut their teeth.",
    color: "#B87333",
    smallBlindAtoms: usdcToAtoms(0.5),
    bigBlindAtoms: usdcToAtoms(1),
    rated: true,
    sortOrder: 1,
  },
  {
    id: "silver",
    name: "London",
    tagline: "The standard room. Deep fields, patient play.",
    color: "#B8C0C8",
    smallBlindAtoms: usdcToAtoms(1),
    bigBlindAtoms: usdcToAtoms(2),
    rated: true,
    sortOrder: 2,
  },
  {
    id: "gold",
    name: "Singapore",
    tagline: "Sharper edges, thinner value.",
    color: "#C9A227",
    smallBlindAtoms: usdcToAtoms(2.5),
    bigBlindAtoms: usdcToAtoms(5),
    rated: true,
    sortOrder: 3,
  },
  {
    id: "platinum",
    name: "Dubai",
    tagline: "High rise, high variance.",
    color: "#8FE3D2",
    smallBlindAtoms: usdcToAtoms(5),
    bigBlindAtoms: usdcToAtoms(10),
    rated: true,
    sortOrder: 4,
  },
  {
    id: "diamond",
    name: "Monaco",
    tagline: "Waterfront tables. Bring a plan.",
    color: "#8FB8FF",
    smallBlindAtoms: usdcToAtoms(25),
    bigBlindAtoms: usdcToAtoms(50),
    rated: true,
    sortOrder: 5,
  },
] as const;

export type CityId = (typeof CITIES)[number]["id"];

export function getCity(id: string): City | null {
  return CITIES.find((c) => c.id === id) ?? null;
}

export function requireCity(id: string): City {
  const city = getCity(id);
  if (!city) throw new Error(`unknown city: ${id}`);
  return city;
}

/** True when this city's results update Arena Rating. */
export function isRatedCity(id: string): boolean {
  return getCity(id)?.rated !== false;
}

/**
 * The two play modes. Casual is a mode, not a price bracket: Porto is Casual
 * because ratings are off there, and Berlin upward are Ranked. Never phrase
 * this as "cheap tables are unranked".
 */
export type CityMode = "casual" | "ranked";

export function cityMode(id: string): CityMode {
  return isRatedCity(id) ? "ranked" : "casual";
}

/** User-facing mode word. Always "Casual" — never "Practice". */
export function cityModeLabel(id: string): "Casual" | "Ranked" {
  return cityMode(id) === "casual" ? "Casual" : "Ranked";
}

/**
 * Naming adapter: `leagueId` (DB column `tables.league_id`, on-chain seat
 * ticket) and `cityId` (the name new TypeScript APIs use) are the same value.
 * Callers may pass either; ids are normalised to lower case.
 */
export type CityRef = {
  cityId?: string | null;
  leagueId?: string | null;
};

export function resolveCityId(ref: CityRef | string | null | undefined): string | null {
  const raw = typeof ref === "string" ? ref : (ref?.cityId ?? ref?.leagueId);
  const id = String(raw ?? "").trim().toLowerCase();
  return id === "" ? null : id;
}

/** `resolveCityId` that rejects a missing or unknown id. */
export function requireCityId(ref: CityRef | string | null | undefined): string {
  const id = resolveCityId(ref);
  if (!id) throw new Error("cityId (or leagueId) is required");
  requireCity(id);
  return id;
}

/**
 * Echo a city id under both spellings so a response satisfies callers that
 * read `leagueId` and callers that read `cityId`.
 */
export function cityIdAlias(id: string): { cityId: string; leagueId: string } {
  return { cityId: id, leagueId: id };
}

export type BuyInBand = {
  minAtoms: bigint;
  maxAtoms: bigint;
  minBb: number;
  maxBb: number;
};

/** The buy-in band for a city: 40BB to 100BB, in atoms. */
export function buyInBand(city: City): BuyInBand {
  return {
    minAtoms: city.bigBlindAtoms * BigInt(MIN_BUY_IN_BB),
    maxAtoms: city.bigBlindAtoms * BigInt(MAX_BUY_IN_BB),
    minBb: MIN_BUY_IN_BB,
    maxBb: MAX_BUY_IN_BB,
  };
}

export type BuyInRejection =
  | "below_minimum"
  | "above_maximum"
  | "not_chip_aligned"
  | "insufficient_balance";

/**
 * Flat (non-discriminated) result on purpose: consumer packages compile with
 * `strictNullChecks: false`, where discriminated-union narrowing does not
 * apply. A flat shape stays usable everywhere.
 */
export type BuyInValidation = {
  ok: boolean;
  /** The validated amount when `ok`; the clamped band edge otherwise. */
  atoms: bigint;
  bb: number;
  band: BuyInBand;
  reason?: BuyInRejection;
  message?: string;
};

/**
 * Validate a requested buy-in against the city's band.
 *
 * `availableAtoms` is the player's bankroll. It can only ever *reduce* what
 * they may bring — it can never raise the ceiling. That asymmetry is the whole
 * point: the table caps the whale, not the other way round.
 */
export function validateBuyIn(input: {
  city: City;
  requestedAtoms: bigint;
  availableAtoms?: bigint;
}): BuyInValidation {
  const band = buyInBand(input.city);
  const { requestedAtoms } = input;
  const bbOf = (a: bigint) => Number(a) / Number(input.city.bigBlindAtoms);

  if (!isChipAlignedSafe(requestedAtoms)) {
    return {
      ok: false,
      atoms: floorToChipAtoms(requestedAtoms),
      bb: bbOf(floorToChipAtoms(requestedAtoms)),
      band,
      reason: "not_chip_aligned",
      message: `Buy-in must be a whole number of $0.01 chips.`,
    };
  }
  if (requestedAtoms < band.minAtoms) {
    return {
      ok: false,
      atoms: band.minAtoms,
      bb: band.minBb,
      band,
      reason: "below_minimum",
      message: `Minimum buy-in for ${input.city.name} is ${formatUsdc(band.minAtoms)} (${band.minBb}BB).`,
    };
  }
  if (requestedAtoms > band.maxAtoms) {
    return {
      ok: false,
      atoms: band.maxAtoms,
      bb: band.maxBb,
      band,
      reason: "above_maximum",
      message: `Maximum buy-in for ${input.city.name} is ${formatUsdc(band.maxAtoms)} (${band.maxBb}BB) — bankroll does not raise this cap.`,
    };
  }
  if (input.availableAtoms != null && requestedAtoms > input.availableAtoms) {
    return {
      ok: false,
      atoms: requestedAtoms,
      bb: bbOf(requestedAtoms),
      band,
      reason: "insufficient_balance",
      message: `Need ${formatUsdc(requestedAtoms)} to sit down — you have ${formatUsdc(input.availableAtoms)}.`,
    };
  }
  return { ok: true, atoms: requestedAtoms, bb: bbOf(requestedAtoms), band };
}

function floorToChipAtoms(atoms: bigint): bigint {
  return (atoms / 10_000n) * 10_000n;
}

function isChipAlignedSafe(atoms: bigint): boolean {
  try {
    assertChipAligned(atoms, "buy-in");
    return true;
  } catch {
    return false;
  }
}

/**
 * Anti rat-holing: a player who leaves a city with a big stack cannot bank the
 * win and immediately re-enter short to dodge deep-stack risk. Within the
 * cooldown, their minimum re-entry is what they left with (still capped by the
 * city maximum, so they are never forced above 100BB).
 */
export const RAT_HOLE_COOLDOWN_MS = 30 * 60 * 1000;

export function minimumReentryAtoms(input: {
  city: City;
  /** Stack the player left this city with, in atoms. */
  lastLeavingStackAtoms: bigint | null;
  /** Milliseconds since they left. */
  msSinceLeaving: number | null;
  cooldownMs?: number;
}): bigint {
  const band = buyInBand(input.city);
  const cooldown = input.cooldownMs ?? RAT_HOLE_COOLDOWN_MS;
  if (
    input.lastLeavingStackAtoms == null ||
    input.msSinceLeaving == null ||
    input.msSinceLeaving >= cooldown
  ) {
    return band.minAtoms;
  }
  // Never demand more than the table maximum, and never less than the floor.
  const floor = input.lastLeavingStackAtoms;
  if (floor <= band.minAtoms) return band.minAtoms;
  return floor > band.maxAtoms ? band.maxAtoms : floor;
}

/**
 * Convenience view for the lobby: stakes and band as display dollars.
 *
 * Every field a city card needs is here, because a card that shows only a
 * city name tells a player nothing about what the seat costs.
 */
export function cityDisplay(city: City) {
  const band = buyInBand(city);
  return {
    id: city.id,
    cityId: city.id,
    /** Same value as `cityId` — see the league_id ≡ cityId note above. */
    leagueId: city.id,
    name: city.name,
    tagline: city.tagline,
    color: city.color,
    rated: city.rated,
    mode: cityMode(city.id),
    modeLabel: cityModeLabel(city.id),
    /** Only game on offer today; shown so a card is never just a name. */
    variantLabel: "NLHE",
    smallBlind: atomsToUsdc(city.smallBlindAtoms),
    bigBlind: atomsToUsdc(city.bigBlindAtoms),
    stakesLabel: `${formatUsdc(city.smallBlindAtoms)} / ${formatUsdc(city.bigBlindAtoms)}`,
    minBuyIn: atomsToUsdc(band.minAtoms),
    maxBuyIn: atomsToUsdc(band.maxAtoms),
    buyInLabel: `${formatUsdc(band.minAtoms)} – ${formatUsdc(band.maxAtoms)}`,
    buyInBbLabel: `${band.minBb} – ${band.maxBb} BB`,
  };
}
