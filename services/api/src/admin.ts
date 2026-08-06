import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { query } from "@mozetto/database";
import { getChainConfig } from "@mozetto/blockchain";

function adminToken(req: FastifyRequest): string | undefined {
  const header = req.headers["x-admin-token"];
  if (typeof header === "string" && header) return header;
  const cookie = req.cookies?.admin_token;
  if (typeof cookie === "string" && cookie) return cookie;
  return undefined;
}

export function requireAdmin(req: FastifyRequest, reply: FastifyReply): boolean {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) {
    reply.code(503).send({ error: "admin_disabled", message: "ADMIN_TOKEN not configured" });
    return false;
  }
  const token = adminToken(req);
  if (token !== expected) {
    reply.code(401).send({ error: "unauthorized" });
    return false;
  }
  return true;
}

export function registerAdminRoutes(app: FastifyInstance) {
  app.get("/v1/admin/overview", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;

    const [activeSessions, queuedTickets, lastReconcile, cursors, flags] = await Promise.all([
      query<{ count: string }>(
        `select count(*)::text as count from onchain_sessions
         where status in ('opened', 'playing', 'settling')`,
      ),
      query<{ count: string }>(
        `select count(*)::text as count from seat_tickets where status = 'queued'`,
      ),
      query(
        `select id::text, chain_id, started_at, finished_at, ok, detail
         from reconciliation_runs order by started_at desc limit 5`,
      ),
      query<{ chain_id: number; last_block: string; updated_at: string }>(
        `select chain_id, last_block::text, updated_at from chain_cursors order by chain_id`,
      ),
      query(`select key, enabled, meta, updated_at from feature_flags order by key`),
    ]);

    const chain = getChainConfig();
    const indexerLag = cursors.rows.map((c) => ({
      chainId: c.chain_id,
      lastBlock: c.last_block,
      updatedAt: c.updated_at,
      note: "Compare updated_at to now for lag; block height vs chain head requires RPC poll.",
    }));

    return {
      activeOnchainSessions: Number(activeSessions.rows[0]?.count ?? 0),
      seatTicketsQueued: Number(queuedTickets.rows[0]?.count ?? 0),
      lastReconciliationRuns: lastReconcile.rows,
      chainCursors: indexerLag,
      featureFlags: flags.rows,
      vaultSolvencyNote:
        "Vault solvency is checked by reconciliation_runs + vault_balance_snapshots. See lastReconciliationRuns.ok.",
      chain: { chainId: chain.chainId, vault: chain.contracts.arenaVault },
    };
  });

  app.get("/v1/admin/sessions", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const limit = Math.min(Number((req.query as { limit?: string }).limit ?? 50), 200);
    const rows = await query(
      `select os.*,
        (select count(*)::int from onchain_session_players p where p.session_id = os.session_id) as player_count
       from onchain_sessions os
       order by os.created_at desc
       limit $1`,
      [limit],
    );
    return { sessions: rows.rows };
  });

  app.get("/v1/admin/session/:sessionId", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const sessionId = (req.params as { sessionId: string }).sessionId;
    const session = await query(`select * from onchain_sessions where session_id = $1`, [sessionId]);
    if (!session.rows[0]) return reply.code(404).send({ error: "not_found" });

    const [players, checkpoints, proposals] = await Promise.all([
      query(`select * from onchain_session_players where session_id = $1 order by seat nulls last`, [
        sessionId,
      ]),
      query(`select * from session_checkpoints where session_id = $1 order by sequence`, [sessionId]),
      query(
        `select sp.*,
          (select count(*)::int from settlement_attestations sa where sa.proposal_id = sp.id) as attestor_count
         from settlement_proposals sp
         where sp.session_id = $1
         order by sp.created_at desc`,
        [sessionId],
      ),
    ]);

    return {
      session: session.rows[0],
      players: players.rows,
      checkpoints: checkpoints.rows,
      settlementProposals: proposals.rows,
    };
  });
}

/** Public verify payload — safe fields only. */
export function registerVerifyRoutes(app: FastifyInstance) {
  app.get("/v1/verify/session/:sessionId", async (req, reply) => {
    const sessionId = (req.params as { sessionId: string }).sessionId;
    const session = await query(
      `select session_id, chain_id, game_template_id, dealer_root, engine_hash, profile_set_hash,
              open_tx_hash, open_block, status, last_sequence, last_balance_root, last_event_root,
              settlement_tx_hash, created_at, opened_at, settled_at
       from onchain_sessions where session_id = $1`,
      [sessionId],
    );
    if (!session.rows[0]) return reply.code(404).send({ error: "not_found" });

    const row = session.rows[0] as Record<string, unknown>;
    const chainId = Number(row.chain_id);
    const chain = getChainConfig(
      chainId === 8453 ? "base" : chainId === 84532 ? "base-sepolia" : chainId === 31337 ? "anvil" : undefined,
    );

    const [players, checkpoints, handRoots, dealer, vrf, proposal] = await Promise.all([
      query(
        `select wallet_address, seat, buy_in_raw, controller_hash, agent_profile_hash
         from onchain_session_players where session_id = $1 order by seat nulls last`,
        [sessionId],
      ),
      query(
        `select sequence, hand_number, event_root, balance_root, randomness_epoch, tx_hash, created_at
         from session_checkpoints where session_id = $1 order by sequence`,
        [sessionId],
      ),
      query(
        `select hand_id, hand_number, hand_root from hand_roots where session_id = $1 order by hand_number`,
        [sessionId],
      ),
      query(`select dealer_root, secret_count from dealer_commitments where session_id = $1 limit 1`, [
        sessionId,
      ]),
      query(
        `select rr.epoch_id, rr.status, rf.vrf_word::text, rf.tx_hash as fulfill_tx
         from randomness_requests rr
         left join randomness_fulfillments rf on rf.session_id = rr.session_id and rf.epoch_id = rr.epoch_id
         where rr.session_id = $1
         order by rr.created_at`,
        [sessionId],
      ),
      query(
        `select sp.id::text, sp.status, sp.final_sequence, sp.event_root, sp.hand_root, sp.balance_root,
                (select count(*)::int from settlement_attestations sa where sa.proposal_id = sp.id) as attestor_count,
                (select tx_hash from settlement_transactions st where st.proposal_id = sp.id order by created_at desc limit 1) as settlement_tx
         from settlement_proposals sp
         where sp.session_id = $1
         order by sp.created_at desc
         limit 1`,
        [sessionId],
      ),
    ]);

    const status = row.status as string;
    const settled = status === "settled" && Boolean(row.settlement_tx_hash);
    const hasCheckpoints = checkpoints.rows.length > 0;
    const verifyStatus = settled && hasCheckpoints ? "verified" : "incomplete";

    return {
      sessionId,
      chainId,
      chainName: chain.name,
      vaultAddress: chain.contracts.arenaVault,
      gameTemplateId: row.game_template_id,
      dealerCommitment: dealer.rows[0] ?? { dealer_root: row.dealer_root },
      vrf: vrf.rows,
      handRoots: handRoots.rows,
      checkpoints: checkpoints.rows,
      players: players.rows,
      settlement: {
        txHash: row.settlement_tx_hash ?? proposal.rows[0]?.settlement_tx ?? null,
        proposalStatus: proposal.rows[0]?.status ?? null,
        attestorCount: proposal.rows[0]?.attestor_count ?? 0,
      },
      status: verifyStatus,
      sessionStatus: status,
      openTxHash: row.open_tx_hash,
      openedAt: row.opened_at,
      settledAt: row.settled_at,
    };
  });
}
