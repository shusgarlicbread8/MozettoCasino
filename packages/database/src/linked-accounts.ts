/**
 * WP-043 — Linked-account / beneficial-owner exclusion interface.
 *
 * Ranked matchmaking must not seat linked wallets together (Plan 04 / Plan 12).
 * The production link graph (funding, device, wallet cluster, admin) is not
 * required here — only a stable lookup contract so the allocator can exclude peers.
 */

export type LinkReason =
  | "manual"
  | "funding"
  | "device"
  | "wallet_cluster"
  | "admin"
  | "stub";

export type LinkedAccountEdge = {
  accountId: string;
  linkedAccountId: string;
  reason: LinkReason;
  /** 0–1 advisory score; exclusion uses presence, not threshold. */
  confidence: number;
};

/**
 * Pluggable source of linked / beneficial-owner peers.
 * Implementations may be sync or async; callers always `await` the result.
 */
export interface LinkedAccountLookup {
  /**
   * Account ids that must not share a ranked table with `accountId`
   * (symmetric cluster membership excluding `accountId` itself).
   */
  getExcludedPeers(accountId: string): ReadonlySet<string> | Promise<ReadonlySet<string>>;
}

/** In-memory undirected link graph — default Season 1 stub until a DB store lands. */
export class StubLinkedAccountStore implements LinkedAccountLookup {
  private readonly adj = new Map<string, Set<string>>();
  private readonly edges: LinkedAccountEdge[] = [];

  constructor(pairs: Array<[string, string]> = []) {
    for (const [a, b] of pairs) this.link(a, b, "stub");
  }

  link(
    a: string,
    b: string,
    reason: LinkReason = "stub",
    confidence = 1,
  ): void {
    if (a === b) return;
    if (!this.adj.has(a)) this.adj.set(a, new Set());
    if (!this.adj.has(b)) this.adj.set(b, new Set());
    this.adj.get(a)!.add(b);
    this.adj.get(b)!.add(a);
    this.edges.push({
      accountId: a,
      linkedAccountId: b,
      reason,
      confidence,
    });
  }

  getExcludedPeers(accountId: string): ReadonlySet<string> {
    return this.adj.get(accountId) ?? new Set();
  }

  listEdges(): readonly LinkedAccountEdge[] {
    return this.edges;
  }
}

/** Empty stub — no links until ops / risk wiring populates a real store. */
export function createDefaultLinkedAccountLookup(): LinkedAccountLookup {
  return new StubLinkedAccountStore();
}

/** Sync helper when the lookup is known to be sync (stub / tests). */
export function isLinkedSync(
  lookup: LinkedAccountLookup,
  a: string,
  b: string,
): boolean {
  if (a === b) return true;
  const peers = lookup.getExcludedPeers(a);
  if (peers instanceof Promise) {
    throw new Error("isLinkedSync requires a synchronous LinkedAccountLookup");
  }
  return peers.has(b);
}

export async function isLinked(
  lookup: LinkedAccountLookup,
  a: string,
  b: string,
): Promise<boolean> {
  if (a === b) return true;
  const peers = await Promise.resolve(lookup.getExcludedPeers(a));
  return peers.has(b);
}

/**
 * Pre-seal ranked integrity: distinct beneficial owners, no linked-cluster pairs.
 * Call before SessionSealCoordinator.seal — after seal, participant roots are immutable (WP-023).
 */
export function assertRankedParticipantIntegrity(opts: {
  ownerIds: readonly string[];
  linkedPeersOf: (ownerId: string) => ReadonlySet<string>;
}): void {
  const seen: string[] = [];
  for (const id of opts.ownerIds) {
    if (seen.includes(id)) {
      throw new Error(`self_match: duplicate beneficial owner ${id}`);
    }
    const peers = opts.linkedPeersOf(id);
    for (const other of seen) {
      if (peers.has(other) || opts.linkedPeersOf(other).has(id)) {
        throw new Error(`linked_account: ${id} linked to seated owner ${other}`);
      }
    }
    seen.push(id);
  }
}
