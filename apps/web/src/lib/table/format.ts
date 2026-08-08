import { color } from "@/lib/design-tokens";
import { money } from "@/lib/session";

/** Engine seats are 0-based; players always see Seat 1…N. */
export function displaySeat(seatIndex: unknown): string {
  const n = Number(seatIndex);
  if (!Number.isFinite(n) || n < 0) return "—";
  return String(Math.floor(n) + 1);
}

export function formatActionLabel(action: string, amount?: number): { text: string; color: string } {
  const a = String(action || "").toLowerCase();
  if (a === "fold") return { text: "FOLD", color: color.danger };
  if (a === "check") return { text: "CHECK", color: "#9AE6C4" };
  if (a === "call") return { text: amount != null ? `CALL ${money(amount)}` : "CALL", color: color.accent };
  if (a === "bet") return { text: amount != null ? `BET ${money(amount)}` : "BET", color: color.warn };
  if (a === "raise") return { text: amount != null ? `RAISE ${money(amount)}` : "RAISE", color: color.warn };
  if (a === "all_in") return { text: amount != null ? `ALL-IN ${money(amount)}` : "ALL-IN", color: color.warn };
  return { text: a.toUpperCase() || "ACT", color: color.text };
}

export type LogRow = {
  n: string;
  name: string;
  act: string;
  color: string;
  actColor: string;
};
