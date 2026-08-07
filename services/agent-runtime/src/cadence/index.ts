/**
 * WP-075 — Public cadence controller (Season 1).
 *
 * Separates provider latency from visible table-clock action timing.
 * Final/public actions only — does not start continuous cognition (WP-073).
 */

export * from "./bounds.js";
export * from "./types.js";
export {
  PublicCadenceController,
  applyPublicCadenceToDecision,
  schedulePublicCadence,
  waitForPublicCadence,
} from "./controller.js";
