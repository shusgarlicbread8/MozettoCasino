/**
 * In-memory AgentStateStore — Season 1 local / test persistence.
 */

import { createHash, randomUUID } from "node:crypto";
import { AGENT_STATE_SCHEMA_VERSION } from "./bounds.js";
import { cloneAgentState, keyEquals, keyToString, stateKeyOf } from "./create.js";
import { pruneAgentState } from "./prune.js";
import type {
  AgentStateCheckpoint,
  AgentStateKey,
  AgentStateStore,
  AgentStateV1,
} from "./types.js";

export interface InMemoryAgentStateStoreOptions {
  now?: () => number;
  createId?: () => string;
}

export class InMemoryAgentStateStore implements AgentStateStore {
  private readonly states = new Map<string, AgentStateV1>();
  private readonly checkpoints = new Map<string, AgentStateCheckpoint[]>();
  private readonly now: () => number;
  private readonly createId: () => string;

  constructor(opts: InMemoryAgentStateStoreOptions = {}) {
    this.now = opts.now ?? (() => Date.now());
    this.createId = opts.createId ?? (() => randomUUID());
  }

  async get(key: AgentStateKey): Promise<AgentStateV1 | null> {
    const s = this.states.get(keyToString(key));
    return s ? cloneAgentState(s) : null;
  }

  async put(state: AgentStateV1): Promise<AgentStateV1> {
    const pruned = pruneAgentState(cloneAgentState(state));
    this.states.set(keyToString(stateKeyOf(pruned)), pruned);
    return cloneAgentState(pruned);
  }

  async delete(key: AgentStateKey): Promise<boolean> {
    const k = keyToString(key);
    const existed = this.states.delete(k);
    this.checkpoints.delete(k);
    return existed;
  }

  async saveCheckpoint(
    state: AgentStateV1,
    savedAtMs?: number,
  ): Promise<AgentStateCheckpoint> {
    const pruned = pruneAgentState(cloneAgentState(state));
    const key = stateKeyOf(pruned);
    const checkpoint: AgentStateCheckpoint = {
      schemaVersion: AGENT_STATE_SCHEMA_VERSION,
      key,
      memoryVersion: pruned.memoryVersion,
      publicEventCursor: pruned.publicEventCursor,
      state: pruned,
      savedAtMs: savedAtMs ?? this.now(),
      checkpointId: this.createId(),
    };
    const k = keyToString(key);
    const list = this.checkpoints.get(k) ?? [];
    list.push(checkpoint);
    this.checkpoints.set(k, list);
    // Keep live state in sync with checkpointed snapshot.
    this.states.set(k, cloneAgentState(pruned));
    return {
      ...checkpoint,
      state: cloneAgentState(pruned),
    };
  }

  async loadLatestCheckpoint(key: AgentStateKey): Promise<AgentStateCheckpoint | null> {
    const list = this.checkpoints.get(keyToString(key));
    if (!list || list.length === 0) return null;
    const latest = list[list.length - 1]!;
    return {
      ...latest,
      state: cloneAgentState(latest.state),
    };
  }

  async listKeys(sessionId?: string): Promise<AgentStateKey[]> {
    const keys: AgentStateKey[] = [];
    for (const s of this.states.values()) {
      const key = stateKeyOf(s);
      if (sessionId == null || key.sessionId === sessionId) keys.push(key);
    }
    return keys.sort((a, b) => keyToString(a).localeCompare(keyToString(b)));
  }

  /** Test helper: number of checkpoints for a key. */
  checkpointCount(key: AgentStateKey): number {
    return this.checkpoints.get(keyToString(key))?.length ?? 0;
  }

  clear(): void {
    this.states.clear();
    this.checkpoints.clear();
  }
}

/** Content hash of structured state (audit aid; not a consensus commitment). */
export function hashAgentStateContent(state: AgentStateV1): string {
  const canonical = JSON.stringify(pruneAgentState(cloneAgentState(state)));
  return createHash("sha256").update(canonical).digest("hex");
}

export function assertSameKey(a: AgentStateKey, b: AgentStateKey): void {
  if (!keyEquals(a, b)) {
    throw new Error(`AgentState key mismatch: ${keyToString(a)} vs ${keyToString(b)}`);
  }
}
