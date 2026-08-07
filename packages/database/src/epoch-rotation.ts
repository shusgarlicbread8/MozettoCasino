/**
 * WP-042 — Epoch join/leave rotation (pure planning + validation).
 *
 * Plan 04 continuous cash-table epochs:
 *   Hand N ACTIVE → queue join/leave/top-up → Hand N completes →
 *   close checkpoint → apply queue → open Epoch N+1 → Hand N+1
 *
 * Invariant: sealed/active hand participants MUST NOT change mid-hand.
 * Leaves requested mid-hand keep the player exposed until the hand finishes.
 * All-in players may queue leave but cannot vacate before hand resolution.
 */

export type HandPhase = "between_hands" | "hand_active";

export type SeatChangeType = "join" | "leave" | "top_up";

export type SeatChangeStatus = "pending" | "applied" | "cancelled" | "rejected";

export type EpochParticipant = {
  ownerId: string;
  seatIndex: number;
  stack: number;
  /** True while the player is all-in in the current hand. */
  allIn?: boolean;
  agentId?: string | null;
};

export type QueuedSeatChange = {
  id: string;
  tableId: string;
  targetEpoch: number;
  changeType: SeatChangeType;
  status: SeatChangeStatus;
  ownerId: string;
  agentId?: string | null;
  agentConfigId?: string | null;
  seatIndex?: number | null;
  amount?: number | null;
  profileKey?: string | null;
  payload?: Record<string, unknown>;
  requestedAt?: string;
};

export type RejectedSeatChange = {
  id: string;
  reason: string;
};

export type EpochBoundaryPlan = {
  /** Leaves to apply (vacate seat + cash out). */
  leaves: QueuedSeatChange[];
  /** Top-ups for players who remain seated after leaves. */
  topUps: QueuedSeatChange[];
  /** Joins into empty seats after leaves. */
  joins: QueuedSeatChange[];
  nextParticipants: EpochParticipant[];
  appliedIds: string[];
  rejected: RejectedSeatChange[];
  /** Epoch number that just closed (hand completed under this epoch). */
  closedEpoch: number;
  /** Epoch number that opens for the next hand. */
  nextEpoch: number;
};

/**
 * Hand is active when a live handId exists and street is not waiting/settlement.
 * Settlement is treated as the closing boundary (queue may flush after settlement).
 */
export function handPhase(opts: {
  handId: string | null | undefined;
  street: string | null | undefined;
}): HandPhase {
  const street = opts.street ?? "waiting";
  if (!opts.handId) return "between_hands";
  if (street === "waiting" || street === "settlement") return "between_hands";
  return "hand_active";
}

export function canMutateParticipants(phase: HandPhase): boolean {
  return phase === "between_hands";
}

export function assertCanMutateParticipants(phase: HandPhase): void {
  if (!canMutateParticipants(phase)) {
    throw new Error("PARTICIPANTS_IMMUTABLE_MID_HAND");
  }
}

/** Target epoch for a newly queued change given the current open epoch and phase. */
export function targetEpochForQueue(currentEpoch: number, phase: HandPhase): number {
  if (currentEpoch < 1) throw new Error("invalid_epoch");
  return phase === "hand_active" ? currentEpoch + 1 : currentEpoch;
}

export type EnqueueValidation =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Validate whether a seat change may be enqueued (not yet applied).
 * Mid-hand enqueue is allowed; mid-hand *apply* is not.
 */
export function validateEnqueue(opts: {
  changeType: SeatChangeType;
  ownerId: string;
  phase: HandPhase;
  participants: EpochParticipant[];
  pending: QueuedSeatChange[];
  amount?: number | null;
}): EnqueueValidation {
  const { changeType, ownerId, phase, participants, pending } = opts;
  const seated = participants.find((p) => p.ownerId === ownerId);
  const pendingForOwner = pending.filter((c) => c.ownerId === ownerId && c.status === "pending");

  if (changeType === "leave") {
    if (!seated) return { ok: false, reason: "not_seated" };
    if (pendingForOwner.some((c) => c.changeType === "leave")) {
      return { ok: false, reason: "leave_already_queued" };
    }
    // All-in: may queue leave (remains exposed) but cannot vacate before resolution.
    // Enqueue is OK; apply waits until between_hands after hand settles.
    if (phase === "hand_active" && seated.allIn) {
      return { ok: true };
    }
    return { ok: true };
  }

  if (changeType === "join") {
    if (seated) return { ok: false, reason: "already_seated" };
    if (pendingForOwner.some((c) => c.changeType === "join")) {
      return { ok: false, reason: "join_already_queued" };
    }
    if (pendingForOwner.some((c) => c.changeType === "leave")) {
      return { ok: false, reason: "conflicting_leave_pending" };
    }
    const amount = opts.amount ?? 0;
    if (!(amount > 0)) return { ok: false, reason: "invalid_buy_in" };
    return { ok: true };
  }

  if (changeType === "top_up") {
    if (!seated) return { ok: false, reason: "not_seated" };
    if (pendingForOwner.some((c) => c.changeType === "leave")) {
      return { ok: false, reason: "leave_pending" };
    }
    const amount = opts.amount ?? 0;
    if (!(amount > 0)) return { ok: false, reason: "invalid_top_up" };
    return { ok: true };
  }

  return { ok: false, reason: "unknown_change_type" };
}

function emptySeatIndices(participants: EpochParticipant[], maxSeats: number): number[] {
  const taken = new Set(participants.map((p) => p.seatIndex));
  const out: number[] = [];
  for (let i = 0; i < maxSeats; i++) {
    if (!taken.has(i)) out.push(i);
  }
  return out;
}

/**
 * Plan application of pending seat changes at an epoch boundary.
 * Order: leaves → top-ups → joins (frees seats before fills).
 */
export function planEpochBoundary(opts: {
  currentEpoch: number;
  participants: EpochParticipant[];
  pending: QueuedSeatChange[];
  maxSeats: number;
}): EpochBoundaryPlan {
  const closedEpoch = opts.currentEpoch;
  const nextEpoch = opts.currentEpoch + 1;
  const rejected: RejectedSeatChange[] = [];
  const appliedIds: string[] = [];

  // Only changes targeting the next epoch (or current if queued between hands before rotate).
  const relevant = opts.pending
    .filter((c) => c.status === "pending")
    .filter((c) => c.targetEpoch === nextEpoch || c.targetEpoch === closedEpoch)
    .slice()
    .sort((a, b) => {
      const rank = (t: SeatChangeType) => (t === "leave" ? 0 : t === "top_up" ? 1 : 2);
      const d = rank(a.changeType) - rank(b.changeType);
      if (d !== 0) return d;
      return String(a.requestedAt ?? a.id).localeCompare(String(b.requestedAt ?? b.id));
    });

  let seats = opts.participants.map((p) => ({ ...p }));
  const leaves: QueuedSeatChange[] = [];
  const topUps: QueuedSeatChange[] = [];
  const joins: QueuedSeatChange[] = [];

  for (const change of relevant) {
    if (change.changeType === "leave") {
      const idx = seats.findIndex((p) => p.ownerId === change.ownerId);
      if (idx < 0) {
        rejected.push({ id: change.id, reason: "not_seated_at_boundary" });
        continue;
      }
      const p = seats[idx]!;
      if (p.allIn) {
        rejected.push({ id: change.id, reason: "all_in_unresolved" });
        continue;
      }
      seats = seats.filter((_, i) => i !== idx);
      leaves.push(change);
      appliedIds.push(change.id);
      continue;
    }

    if (change.changeType === "top_up") {
      const p = seats.find((s) => s.ownerId === change.ownerId);
      if (!p) {
        rejected.push({ id: change.id, reason: "not_seated_at_boundary" });
        continue;
      }
      const amount = Number(change.amount ?? 0);
      if (!(amount > 0)) {
        rejected.push({ id: change.id, reason: "invalid_top_up" });
        continue;
      }
      p.stack += amount;
      topUps.push(change);
      appliedIds.push(change.id);
      continue;
    }

    if (change.changeType === "join") {
      if (seats.some((s) => s.ownerId === change.ownerId)) {
        rejected.push({ id: change.id, reason: "already_seated" });
        continue;
      }
      const amount = Number(change.amount ?? 0);
      if (!(amount > 0)) {
        rejected.push({ id: change.id, reason: "invalid_buy_in" });
        continue;
      }
      const empties = emptySeatIndices(seats, opts.maxSeats);
      const preferred =
        change.seatIndex != null && empties.includes(change.seatIndex)
          ? change.seatIndex
          : empties[0];
      if (preferred == null) {
        rejected.push({ id: change.id, reason: "no_open_seat" });
        continue;
      }
      seats.push({
        ownerId: change.ownerId,
        seatIndex: preferred,
        stack: amount,
        agentId: change.agentId ?? null,
        allIn: false,
      });
      joins.push({ ...change, seatIndex: preferred });
      appliedIds.push(change.id);
    }
  }

  seats.sort((a, b) => a.seatIndex - b.seatIndex);

  return {
    leaves,
    topUps,
    joins,
    nextParticipants: seats,
    appliedIds,
    rejected,
    closedEpoch,
    nextEpoch,
  };
}

/** Snapshot suitable for `table_epochs.participant_snapshot`. */
export function participantSnapshot(participants: EpochParticipant[]): unknown[] {
  return participants.map((p) => ({
    ownerId: p.ownerId,
    seatIndex: p.seatIndex,
    stack: p.stack,
    agentId: p.agentId ?? null,
  }));
}
