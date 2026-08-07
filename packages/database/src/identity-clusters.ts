/**
 * Plan 19 §024 / WP-043 — DB-backed identity cluster lookup.
 * Reads identity_cluster_edges + matchmaking_exclusions (migration 027).
 * Falls back gracefully when tables are missing (pre-migrate environments).
 */
import { query } from "./client.js";
import {
  StubLinkedAccountStore,
  type LinkedAccountLookup,
  type LinkReason,
} from "./linked-accounts.js";

export type IdentityClusterEdgeRow = {
  accountId: string;
  linkedAccountId: string;
  reason: LinkReason;
  confidence: number;
  clusterId: string | null;
};

/** Async LinkedAccountLookup over Postgres identity_cluster_edges. */
export class DbLinkedAccountStore implements LinkedAccountLookup {
  async getExcludedPeers(accountId: string): Promise<ReadonlySet<string>> {
    const peers = new Set<string>();
    try {
      const edges = await query<{ linked_account_id: string; account_id: string }>(
        `select account_id, linked_account_id
         from identity_cluster_edges
         where account_id = $1::uuid or linked_account_id = $1::uuid`,
        [accountId],
      );
      for (const row of edges.rows) {
        if (row.account_id === accountId) peers.add(row.linked_account_id);
        if (row.linked_account_id === accountId) peers.add(row.account_id);
      }

      const exclusions = await query<{ excluded_account_id: string }>(
        `select excluded_account_id
         from matchmaking_exclusions
         where account_id = $1::uuid
           and (expires_at is null or expires_at > now())`,
        [accountId],
      );
      for (const row of exclusions.rows) peers.add(row.excluded_account_id);
    } catch {
      // Tables not migrated yet — empty set (same posture as StubLinkedAccountStore default).
    }
    peers.delete(accountId);
    return peers;
  }
}

export async function listIdentityClusterEdges(
  accountId: string,
): Promise<IdentityClusterEdgeRow[]> {
  try {
    const res = await query<{
      account_id: string;
      linked_account_id: string;
      reason: LinkReason;
      confidence: number;
      cluster_id: string | null;
    }>(
      `select account_id::text, linked_account_id::text, reason, confidence, cluster_id::text
       from identity_cluster_edges
       where account_id = $1::uuid or linked_account_id = $1::uuid
       order by created_at desc`,
      [accountId],
    );
    return res.rows.map((r) => ({
      accountId: r.account_id,
      linkedAccountId: r.linked_account_id,
      reason: r.reason,
      confidence: Number(r.confidence),
      clusterId: r.cluster_id,
    }));
  } catch {
    return [];
  }
}

/** Prefer DB store when DATABASE_URL is set; otherwise empty stub. */
export function createLinkedAccountLookupFromEnv(): LinkedAccountLookup {
  if (process.env.DATABASE_URL) return new DbLinkedAccountStore();
  return new StubLinkedAccountStore();
}
