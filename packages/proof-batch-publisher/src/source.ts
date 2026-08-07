import type { CheckpointLeaf, CheckpointSource } from "./types.js";

/** In-memory pending checkpoint queue for tests / local runners. */
export class MemoryCheckpointSource implements CheckpointSource {
  private pending: CheckpointLeaf[] = [];

  enqueue(...leaves: CheckpointLeaf[]): void {
    this.pending.push(...leaves);
  }

  size(): number {
    return this.pending.length;
  }

  peek(): readonly CheckpointLeaf[] {
    return this.pending;
  }

  drainPending(): CheckpointLeaf[] {
    const out = this.pending;
    this.pending = [];
    return out;
  }
}
