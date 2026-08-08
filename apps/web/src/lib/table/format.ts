import { color } from "@/lib/design-tokens";
import { money } from "@/lib/session";

/** Engine seats are 0-based; players always see Seat 1…N. */
export function displaySeat(seatIndex: unknown): string {
  const n = Number(seatIndex);
  if (!Number.isFinite(n) || n < 0) return "—";
  return String(Math.floor(n) + 1);
}

/**
 * Convert engine chip amounts (1 chip = $0.01) to display dollars.
 * Persisted hand_events and WS event payloads use chips; snapshots are already USD.
 *
 * Implemented locally (do not import @mozetto/game-rules here) — that package
 * pulls `node:crypto` via cards/fixtures and breaks the Next.js client bundle.
 */
export function usdFromChips(amount: unknown): number {
  if (amount == null || amount === "") return 0;
  const n = typeof amount === "bigint" ? Number(amount) : Number(amount);
  if (!Number.isFinite(n)) return 0;
  return Math.trunc(n) / 100;
}

export function moneyFromChips(amount: unknown): string {
  return money(usdFromChips(amount));
}

/** Format an action using a USD amount (snapshots, agent_decisions). */
export function formatActionLabel(action: string, amountUsd?: number): { text: string; color: string } {
  const a = String(action || "").toLowerCase();
  if (a === "fold") return { text: "FOLD", color: color.danger };
  if (a === "check") return { text: "CHECK", color: "#9AE6C4" };
  if (a === "call") return { text: amountUsd != null ? `CALL ${money(amountUsd)}` : "CALL", color: color.accent };
  if (a === "bet") return { text: amountUsd != null ? `BET ${money(amountUsd)}` : "BET", color: color.warn };
  if (a === "raise") return { text: amountUsd != null ? `RAISE ${money(amountUsd)}` : "RAISE", color: color.warn };
  if (a === "all_in") return { text: amountUsd != null ? `ALL-IN ${money(amountUsd)}` : "ALL-IN", color: color.warn };
  return { text: a.toUpperCase() || "ACT", color: color.text };
}

/** Format an action using a chip amount from engine / hand_events payloads. */
export function formatChipActionLabel(
  action: string,
  amountChips?: number | string | null,
): { text: string; color: string } {
  const usd =
    amountChips != null && amountChips !== "" && Number(amountChips) > 0
      ? usdFromChips(amountChips)
      : undefined;
  return formatActionLabel(action, usd);
}

export type LogRow = {
  n: string;
  name: string;
  act: string;
  color: string;
  actColor: string;
};
