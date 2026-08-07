/**
 * Priority queue for background cognition jobs (WP-073).
 * Higher priority first; FIFO within the same priority.
 */

import type { CognitionJob } from "./types.js";

export class CognitionPriorityQueue {
  private readonly items: CognitionJob[] = [];

  get size(): number {
    return this.items.length;
  }

  peek(): CognitionJob | undefined {
    return this.items[0];
  }

  enqueue(job: CognitionJob): void {
    this.items.push(job);
    this.items.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return a.enqueuedAtMs - b.enqueuedAtMs;
    });
  }

  dequeue(): CognitionJob | undefined {
    return this.items.shift();
  }

  /** Cancel all queued (not running) jobs. Returns cancelled jobs. */
  cancelAll(note = "preempted"): CognitionJob[] {
    const cancelled: CognitionJob[] = [];
    while (this.items.length) {
      const job = this.items.shift()!;
      job.status = "cancelled";
      job.note = note;
      job.abort?.abort();
      cancelled.push(job);
    }
    return cancelled;
  }

  /** Cancel a single queued job by id. */
  cancel(id: string, note = "cancelled"): CognitionJob | null {
    const idx = this.items.findIndex((j) => j.id === id);
    if (idx < 0) return null;
    const [job] = this.items.splice(idx, 1);
    job.status = "cancelled";
    job.note = note;
    job.abort?.abort();
    return job;
  }

  toArray(): CognitionJob[] {
    return [...this.items];
  }

  clear(): void {
    this.items.length = 0;
  }
}
