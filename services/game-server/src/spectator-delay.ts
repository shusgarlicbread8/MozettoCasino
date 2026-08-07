/**
 * WP-129 residual — server-side spectator delay buffer (Plan 07 `spectator-delayed`).
 *
 * Public WS frames for `role: "spectator"` are held for SPECTATOR_DELAY_MS (default 90s)
 * before delivery. Players / owners are unaffected.
 */

export const DEFAULT_SPECTATOR_DELAY_MS = 90_000;

export type SpectatorOutboundMessage = {
  type: string;
  [key: string]: unknown;
};

export type SpectatorBufferedFrame = {
  enqueuedAt: number;
  messages: SpectatorOutboundMessage[];
  /** Set when the frame has been flushed to currently connected spectators. */
  delivered: boolean;
};

export function resolveSpectatorDelayMs(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): number {
  const raw = env.SPECTATOR_DELAY_MS;
  if (raw == null || String(raw).trim() === "") return DEFAULT_SPECTATOR_DELAY_MS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_SPECTATOR_DELAY_MS;
  return Math.trunc(n);
}

/**
 * Whether a persisted/broadcast table event may appear on the spectator channel.
 * Owner-private payloads (e.g. HOLE_CARDS_PRIVATE) must never be delayed-or-sent to spectators.
 */
export function isSpectatorSafeEvent(event: {
  visibility?: string;
  eventType?: string;
  payload?: unknown;
}): boolean {
  const vis = event.visibility ?? "public";
  if (vis === "owner_private") return false;
  // System deal announcement is seat indices only (no cards) — safe when delayed.
  if (vis === "system") {
    return (event.eventType ?? "") === "HOLE_CARDS_DEALT";
  }
  return vis === "public";
}

export class SpectatorDelayBuffer {
  readonly delayMs: number;
  private readonly now: () => number;
  private readonly maxRetainMs: number;
  private frames: SpectatorBufferedFrame[] = [];

  constructor(opts?: {
    delayMs?: number;
    now?: () => number;
    /** How long to keep frames after enqueue for late-subscriber catch-up. */
    maxRetainMs?: number;
  }) {
    this.delayMs = opts?.delayMs ?? DEFAULT_SPECTATOR_DELAY_MS;
    this.now = opts?.now ?? Date.now;
    this.maxRetainMs = opts?.maxRetainMs ?? Math.max(this.delayMs + 60_000, this.delayMs * 2);
  }

  get size(): number {
    return this.frames.length;
  }

  enqueue(messages: SpectatorOutboundMessage[], at = this.now()): void {
    if (messages.length === 0) return;
    this.frames.push({
      enqueuedAt: at,
      messages: messages.map((m) => ({ ...m })),
      delivered: false,
    });
    this.trim(at);
  }

  /** Newly due, not-yet-flushed frames (marks them delivered). */
  takeDue(at = this.now()): SpectatorBufferedFrame[] {
    const due: SpectatorBufferedFrame[] = [];
    for (const frame of this.frames) {
      if (frame.delivered) continue;
      if (at - frame.enqueuedAt < this.delayMs) continue;
      frame.delivered = true;
      due.push(frame);
    }
    this.trim(at);
    return due;
  }

  /**
   * Latest due snapshot message for a newly subscribed spectator.
   * Returns null when the buffer has not aged past the delay yet (no live leak).
   */
  latestDueSnapshot(at = this.now()): SpectatorOutboundMessage | null {
    let best: SpectatorOutboundMessage | null = null;
    for (const frame of this.frames) {
      if (at - frame.enqueuedAt < this.delayMs) continue;
      for (const msg of frame.messages) {
        if (msg.type === "snapshot") best = msg;
      }
    }
    return best;
  }

  /** ms until the next undelivered frame becomes due, or null if none pending. */
  msUntilNextDue(at = this.now()): number | null {
    let min: number | null = null;
    for (const frame of this.frames) {
      if (frame.delivered) continue;
      const wait = this.delayMs - (at - frame.enqueuedAt);
      const clamped = Math.max(0, wait);
      if (min == null || clamped < min) min = clamped;
    }
    return min;
  }

  clear(): void {
    this.frames = [];
  }

  private trim(at: number): void {
    const cutoff = at - this.maxRetainMs;
    while (this.frames.length > 0) {
      const head = this.frames[0]!;
      if (head.enqueuedAt >= cutoff) break;
      // Keep undelivered frames even if old (clock skew / paused flush).
      if (!head.delivered) break;
      this.frames.shift();
    }
  }
}
