/**
 * Indexer lag / health metrics (in-process; exposed via /health).
 */

export type IndexerMetricsSnapshot = {
  ok: boolean;
  service: "chain-indexer";
  version: "v3";
  chainId: number | null;
  env: string | null;
  cursorBlock: string | null;
  chainHead: string | null;
  safeHead: string | null;
  /** Blocks behind safe head (confirmations already subtracted). */
  lagBlocks: number;
  confirmations: number;
  lastTickAt: string | null;
  lastTickOk: boolean;
  lastTickError: string | null;
  ticksTotal: number;
  logsProcessedTotal: number;
  reorgsDetected: number;
  rebuilds: number;
  watchedContracts: Record<string, string>;
  moneyPathContracts: string[];
};

export class IndexerMetrics {
  chainId: number | null = null;
  env: string | null = null;
  cursorBlock: bigint | null = null;
  chainHead: bigint | null = null;
  safeHead: bigint | null = null;
  confirmations = 0;
  lastTickAt: Date | null = null;
  lastTickOk = true;
  lastTickError: string | null = null;
  ticksTotal = 0;
  logsProcessedTotal = 0;
  reorgsDetected = 0;
  rebuilds = 0;
  watchedContracts: Record<string, string> = {};
  moneyPathContracts: string[] = [];

  lagBlocks(): number {
    if (this.cursorBlock == null || this.safeHead == null) return 0;
    const lag = this.safeHead - this.cursorBlock;
    return lag > 0n ? Number(lag) : 0;
  }

  noteTickStart(chainId: number, env: string) {
    this.chainId = chainId;
    this.env = env;
  }

  noteHeads(cursor: bigint, chainHead: bigint, safeHead: bigint, confirmations: number) {
    this.cursorBlock = cursor;
    this.chainHead = chainHead;
    this.safeHead = safeHead;
    this.confirmations = confirmations;
  }

  noteTickSuccess(logs: number) {
    this.ticksTotal += 1;
    this.logsProcessedTotal += logs;
    this.lastTickAt = new Date();
    this.lastTickOk = true;
    this.lastTickError = null;
  }

  noteTickFailure(err: unknown) {
    this.ticksTotal += 1;
    this.lastTickAt = new Date();
    this.lastTickOk = false;
    this.lastTickError = err instanceof Error ? err.message : String(err);
  }

  noteReorg() {
    this.reorgsDetected += 1;
  }

  noteRebuild() {
    this.rebuilds += 1;
  }

  setWatched(summary: Record<string, string>, moneyKeys: string[]) {
    this.watchedContracts = summary;
    this.moneyPathContracts = moneyKeys;
  }

  snapshot(): IndexerMetricsSnapshot {
    const lag = this.lagBlocks();
    const stale =
      this.lastTickAt != null && Date.now() - this.lastTickAt.getTime() > 120_000;
    return {
      ok: this.lastTickOk && !stale && lag < 500,
      service: "chain-indexer",
      version: "v3",
      chainId: this.chainId,
      env: this.env,
      cursorBlock: this.cursorBlock?.toString() ?? null,
      chainHead: this.chainHead?.toString() ?? null,
      safeHead: this.safeHead?.toString() ?? null,
      lagBlocks: lag,
      confirmations: this.confirmations,
      lastTickAt: this.lastTickAt?.toISOString() ?? null,
      lastTickOk: this.lastTickOk,
      lastTickError: this.lastTickError,
      ticksTotal: this.ticksTotal,
      logsProcessedTotal: this.logsProcessedTotal,
      reorgsDetected: this.reorgsDetected,
      rebuilds: this.rebuilds,
      watchedContracts: this.watchedContracts,
      moneyPathContracts: this.moneyPathContracts,
    };
  }
}

export const metrics = new IndexerMetrics();

/** Pure helper for tests. */
export function computeLagBlocks(cursor: bigint, safeHead: bigint): number {
  const lag = safeHead - cursor;
  return lag > 0n ? Number(lag) : 0;
}

/** Pure helper: whether a stored block hash disagrees with chain (reorg). */
export function isReorgMismatch(
  storedHash: string | null | undefined,
  chainHash: string | null | undefined,
): boolean {
  if (!storedHash || !chainHash) return false;
  return storedHash.toLowerCase() !== chainHash.toLowerCase();
}
