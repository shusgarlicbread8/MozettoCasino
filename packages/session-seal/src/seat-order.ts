import type { SealParticipant } from "./types.js";

export type SeatedParticipant = SealParticipant & { seat: number };

/**
 * Apply WP-040 `seat_order` so `tickets[i]` maps to seat `i` (SESSION_V2 / vault rule).
 *
 * `seatOrder[i]` = seat assigned to `participants[i]`.
 * Must be a permutation of `[0..n-1]` with `n === participants.length`.
 */
export function applySeatOrder(
  participants: SealParticipant[],
  seatOrder?: number[],
): SeatedParticipant[] {
  const n = participants.length;
  if (n === 0) {
    throw new Error("seal requires at least one participant");
  }

  const order = seatOrder ?? participants.map((_, i) => i);
  if (order.length !== n) {
    throw new Error(`seatOrder length ${order.length} != participants ${n}`);
  }

  const seen = new Set<number>();
  for (const seat of order) {
    if (!Number.isInteger(seat) || seat < 0 || seat >= n) {
      throw new Error(`seatOrder contains invalid seat ${seat} for n=${n}`);
    }
    if (seen.has(seat)) {
      throw new Error(`seatOrder has duplicate seat ${seat}`);
    }
    seen.add(seat);
  }

  const bySeat: SeatedParticipant[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const seat = order[i]!;
    bySeat[seat] = { ...participants[i]!, seat };
  }
  return bySeat;
}

/** Assert all tickets share template / buy-in consistency gates used at seal. */
export function assertHomogeneousTickets(seated: SeatedParticipant[], gameTemplateId: string): void {
  const accounts = new Set<string>();
  for (const p of seated) {
    if (p.ticket.gameTemplateId.toLowerCase() !== gameTemplateId.toLowerCase()) {
      throw new Error(
        `ticket template ${p.ticket.gameTemplateId} != session template ${gameTemplateId}`,
      );
    }
    const key = p.ticket.arenaAccount.toLowerCase();
    if (accounts.has(key)) {
      throw new Error(`duplicate arenaAccount ${p.ticket.arenaAccount}`);
    }
    accounts.add(key);
  }
}
