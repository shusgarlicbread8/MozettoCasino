import type { ProviderSloHooks } from "./types.js";

export interface RetryDecision {
  retry: boolean;
  delayMs: number;
  reason: string;
}

/**
 * Rate-limit / transient retry policy with SLO hooks.
 *
 * Season 1 hypothesis defaults (not proven optima):
 * - exponential backoff base 250ms, cap 4s
 * - honor Retry-After when present on 429
 */
export function computeRetryDelay(opts: {
  attempt: number; // 1-based completed attempt about to retry from
  statusCode?: number;
  retryAfterHeader?: string | null;
  baseMs: number;
  maxMs?: number;
}): number {
  const maxMs = opts.maxMs ?? 4_000;
  if (opts.statusCode === 429 && opts.retryAfterHeader) {
    const sec = Number(opts.retryAfterHeader);
    if (Number.isFinite(sec) && sec >= 0) {
      return Math.min(Math.ceil(sec * 1000), maxMs * 2);
    }
  }
  const exp = opts.baseMs * 2 ** Math.max(0, opts.attempt - 1);
  const jitter = Math.floor(Math.random() * Math.min(50, opts.baseMs));
  return Math.min(exp + jitter, maxMs);
}

export function shouldRetryHttp(statusCode: number): boolean {
  return statusCode === 429 || statusCode === 408 || statusCode >= 500;
}

export function notifyRetry(
  hooks: ProviderSloHooks | undefined,
  meta: { attempt: number; delayMs: number; reason: string },
): void {
  hooks?.onRetry?.(meta);
}

export function notifyRateLimited(
  hooks: ProviderSloHooks | undefined,
  meta: { retryAfterMs?: number; attempt: number; statusCode: number },
): void {
  hooks?.onRateLimited?.(meta);
}

export class CircuitBreaker {
  private consecutiveFailures = 0;
  private openUntil = 0;

  constructor(
    private readonly failureThreshold: number,
    private readonly cooldownMs: number,
    private readonly now: () => number,
    private readonly onChange?: ProviderSloHooks["onCircuitStateChange"],
  ) {}

  isOpen(): boolean {
    if (this.openUntil === 0) return false;
    if (this.now() >= this.openUntil) {
      this.openUntil = 0;
      this.onChange?.({ open: false, consecutiveFailures: this.consecutiveFailures });
      return false;
    }
    return true;
  }

  recordSuccess(): void {
    const wasOpen = this.openUntil > 0;
    this.consecutiveFailures = 0;
    this.openUntil = 0;
    if (wasOpen) {
      this.onChange?.({ open: false, consecutiveFailures: 0 });
    }
  }

  recordFailure(): void {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.failureThreshold && this.openUntil === 0) {
      this.openUntil = this.now() + this.cooldownMs;
      this.onChange?.({ open: true, consecutiveFailures: this.consecutiveFailures });
    }
  }

  getConsecutiveFailures(): number {
    return this.consecutiveFailures;
  }
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      return;
    }
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      },
      { once: true },
    );
  });
}
