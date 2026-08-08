/**
 * WP-090 — Public Verify Game API (safe fields only; no admin secrets).
 * WP-090/085 follow-up — surfaces persisted proof-batch inclusion proofs when present.
 */
import type { FastifyInstance } from "fastify";
import {
  inclusionComponentStatus,
  listInclusionProofsForSession,
  query,
} from "@mozetto/database";
import { getChainConfig, getManifest, resolveNetworkKey } from "@mozetto/blockchain";
import {
  derivePublicVerifyStatus,
  deriveVerifyComponents,
  toLegacyBadge,
  type PublicVerifyStatus,
} from "./verify-status.js";

function chainEnvFromId(chainId: number) {
  if (chainId === 8453) return "base" as const;
  if (chainId === 84532) return "base-sepolia" as const;
  if (chainId === 31337) return "anvil" as const;
  return undefined;
}

function publicContracts(chainId: number) {
  const env = chainEnvFromId(chainId);
  const chain = getChainConfig(env);
  const network =
    env === "base" ? "base" : env === "anvil" ? "anvil" : resolveNetworkKey(env);
  const m = getManifest(network);
  return {
    arenaVault: chain.contracts.arenaVault,
    settlementHub: chain.contracts.settlementHub,
    settlementHubV3: m.settlementHubV3 ?? null,
    checkpointRegistry: chain.contracts.checkpointRegistry,
    randomnessBeacon: m.randomnessBeacon ?? null,
    randomnessCoordinator: chain.contracts.randomnessCoordinator,
    proofBatchRegistry: m.proofBatchRegistry ?? null,
    gameRegistry: m.gameRegistry ?? null,
    sessionLifecycle: m.sessionLifecycle ?? null,
    protocolFeeVault: m.protocolFeeVault ?? null,
  };
}

function looksLikeHex(q: string): boolean {
  return /^0x[0-9a-fA-F]{16,}$/.test(q) || /^[0-9a-fA-F]{64}$/.test(q);
}

function normalizeHex(q: string): string {
  const t = q.trim();
  if (/^[0-9a-fA-F]{64}$/.test(t)) return `0x${t.toLowerCase()}`;
  if (t.startsWith("0x") || t.startsWith("0X")) return `0x${t.slice(2).toLowerCase()}`;
  return t;
}

async function resolveOnchainSessionId(idOrTable: string): Promise<string | null> {
  const exact = await query(`select session_id from onchain_sessions where session_id = $1 limit 1`, [
    idOrTable,
  ]);
  if (exact.rows[0]) return String((exact.rows[0] as { session_id: string }).session_id);
  // Match Result URLs use table ids (arena_…) — map to the latest on-chain session.
  const byTable = await query(
    `select session_id from onchain_sessions where table_id = $1
     order by coalesce(settled_at, opened_at, created_at) desc nulls last
     limit 1`,
    [idOrTable],
  );
  if (byTable.rows[0]) return String((byTable.rows[0] as { session_id: string }).session_id);
  return null;
}

async function loadSessionPayload(idOrTable: string) {
  const sessionId = await resolveOnchainSessionId(idOrTable);
  if (!sessionId) return null;
  const session = await query(
    `select session_id, chain_id, game_template_id, dealer_root, engine_hash, profile_set_hash,
            open_tx_hash, open_block, status, last_sequence, last_balance_root, last_event_root,
            settlement_tx_hash, created_at, opened_at, settled_at
     from onchain_sessions where session_id = $1`,
    [sessionId],
  );
  if (!session.rows[0]) return null;

  const row = session.rows[0] as Record<string, unknown>;
  const chainId = Number(row.chain_id);
  const chain = getChainConfig(chainEnvFromId(chainId));

  const [players, checkpoints, handRoots, dealer, vrf, proposal, eventTip, inclusionProofs] =
    await Promise.all([
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
              sp.total_rake::text as total_rake,
              (select count(*)::int from settlement_attestations sa where sa.proposal_id = sp.id) as attestor_count,
              (select tx_hash from settlement_transactions st where st.proposal_id = sp.id order by created_at desc limit 1) as settlement_tx
       from settlement_proposals sp
       where sp.session_id = $1
       order by sp.created_at desc
       limit 1`,
        [sessionId],
      ),
      query(
        `select sequence, event_hash, previous_event_hash, event_type, hand_id, schema_kind
       from canonical_game_events
       where session_id = $1
       order by sequence desc
       limit 8`,
        [sessionId],
      ).catch(() => ({ rows: [] as Record<string, unknown>[] })),
      listInclusionProofsForSession(sessionId),
    ]);

  const dealerRoot =
    (dealer.rows[0] as { dealer_root?: string } | undefined)?.dealer_root ??
    (row.dealer_root as string | null) ??
    null;
  const prop = proposal.rows[0] as
    | {
        status: string;
        attestor_count: number;
        settlement_tx: string | null;
        final_sequence: string;
        event_root: string;
        hand_root: string;
        balance_root: string;
        total_rake: string;
        id: string;
      }
    | undefined;

  const settlementTx =
    (row.settlement_tx_hash as string | null) ?? prop?.settlement_tx ?? null;
  const vrfRows = vrf.rows as Array<{ status: string; vrf_word?: string; fulfill_tx?: string }>;
  const checkpointRows = checkpoints.rows as Array<{ tx_hash: string | null }>;

  const statusInput = {
    sessionStatus: row.status as string,
    settlementTxHash: settlementTx,
    proposalStatus: prop?.status ?? null,
    attestorCount: prop?.attestor_count ?? 0,
    checkpointCount: checkpointRows.length,
    checkpointWithTxCount: checkpointRows.filter((c) => Boolean(c.tx_hash)).length,
    handRootCount: handRoots.rows.length,
    vrfFulfilledCount: vrfRows.filter((v) => v.status === "fulfilled" || Boolean(v.vrf_word)).length,
    vrfRequestCount: vrfRows.length,
    dealerRoot,
    lastEventRoot: (row.last_event_root as string | null) ?? null,
    lastBalanceRoot: (row.last_balance_root as string | null) ?? null,
  };

  const result: PublicVerifyStatus = derivePublicVerifyStatus(statusInput);
  const components = {
    ...deriveVerifyComponents(statusInput),
    // Additive; does not affect Plan 10 public result categories.
    proofBatchInclusion: inclusionComponentStatus(inclusionProofs),
  };

  const proofBatchInclusion = {
    status: components.proofBatchInclusion,
    count: inclusionProofs.length,
    proofs: inclusionProofs.map((p) => ({
      sessionId: p.sessionId,
      checkpointId: p.checkpointId,
      checkpointRoot: p.checkpointRoot,
      leafIndex: p.leafIndex,
      proof: p.proof,
      globalRoot: p.globalRoot,
      batchSequence: p.batchSequence,
      previousBatchRoot: p.previousBatchRoot,
      dataManifestHash: p.dataManifestHash,
      proofBatchHash: p.proofBatchHash,
      createdAt: p.createdAtChain,
      txHash: p.txHash,
      verifiedLocally: p.verifiedLocally,
    })),
    note:
      inclusionProofs.length === 0
        ? "No proof-batch inclusion proofs published for this session yet."
        : "Merkle inclusion of checkpoint roots under ProofBatchRegistry globalRoot (public paths only).",
  };

  return {
    workPacket: "WP-090",
    sessionId,
    chainId,
    chainName: chain.name,
    protocolVersion: chain.protocolVersion,
    contracts: publicContracts(chainId),
    vaultAddress: chain.contracts.arenaVault,
    gameTemplateId: row.game_template_id,
    hashes: {
      engineHash: row.engine_hash ?? null,
      profileSetHash: row.profile_set_hash ?? null,
      dealerRoot,
      lastEventRoot: row.last_event_root ?? null,
      lastBalanceRoot: row.last_balance_root ?? null,
      lastSequence: row.last_sequence != null ? String(row.last_sequence) : null,
    },
    dealerCommitment: dealer.rows[0] ?? { dealer_root: dealerRoot, secret_count: null },
    vrf: vrf.rows,
    handRoots: handRoots.rows,
    checkpoints: checkpoints.rows,
    eventTip: (eventTip.rows as Record<string, unknown>[]).reverse(),
    players: players.rows,
    settlement: {
      txHash: settlementTx,
      proposalStatus: prop?.status ?? null,
      attestorCount: prop?.attestor_count ?? 0,
      digest: prop
        ? {
            proposalId: prop.id,
            finalSequence: String(prop.final_sequence),
            eventRoot: prop.event_root,
            handRoot: prop.hand_root,
            balanceRoot: prop.balance_root,
            totalRake: prop.total_rake,
          }
        : null,
    },
    components,
    proofBatchInclusion,
    result,
    /** @deprecated use `result` */
    status: toLegacyBadge(result),
    sessionStatus: row.status,
    openTxHash: row.open_tx_hash,
    openBlock: row.open_block != null ? String(row.open_block) : null,
    openedAt: row.opened_at,
    settledAt: row.settled_at,
    localVerify: {
      wasm: {
        build: "pnpm build:poker-wasm",
        run: "pnpm test:poker-wasm",
        docs: "docs/WP-035_WASM_VERIFIER.md",
      },
      replayEvents: {
        run: "cargo run -q -p poker-replay -- verify-events --golden 03",
        docs: "docs/WP-064_REPLAY_VERIFIER.md",
      },
      randomness: {
        run: "pnpm verify:randomness",
        docs: "docs/WP-055_RANDOMNESS_VERIFIER.md",
      },
      replayService: {
        verifySession: "POST /v1/verify-session (replay-verifier :4004)",
        verifyTranscript: "POST /v1/verify-transcript",
      },
    },
  };
}

export function registerVerifyRoutes(app: FastifyInstance) {
  app.get("/v1/verify/session/:sessionId", async (req, reply) => {
    const sessionId = (req.params as { sessionId: string }).sessionId;
    const payload = await loadSessionPayload(sessionId);
    if (!payload) return reply.code(404).send({ error: "not_found" });
    return payload;
  });

  /** Resolve session / hand by id or root / event hash. */
  app.get("/v1/verify/resolve", async (req, reply) => {
    const qRaw = String((req.query as { q?: string }).q ?? "").trim();
    if (!qRaw || qRaw.length < 4) {
      return reply.code(400).send({ error: "query_required", message: "Pass ?q=sessionId|handId|0xhash" });
    }
    const q = looksLikeHex(qRaw) ? normalizeHex(qRaw) : qRaw;

    // Exact session id or table id (arena_…)
    const resolvedSession = await resolveOnchainSessionId(q);
    if (resolvedSession) {
      return {
        kind: "session",
        sessionId: resolvedSession,
        href: `/verify/${encodeURIComponent(resolvedSession)}`,
      };
    }

    // Hand root / hand id
    const byHand = await query(
      `select session_id, hand_id, hand_number, hand_root
       from hand_roots
       where hand_id = $1 or lower(hand_root) = lower($1)
       limit 5`,
      [q],
    );
    if (byHand.rows.length > 0) {
      const row = byHand.rows[0] as {
        session_id: string;
        hand_id: string;
        hand_number: number;
        hand_root: string;
      };
      return {
        kind: "hand",
        sessionId: row.session_id,
        handId: row.hand_id,
        handNumber: row.hand_number,
        handRoot: row.hand_root,
        matches: byHand.rows,
        href: `/verify/hand/${encodeURIComponent(row.hand_id)}`,
        sessionHref: `/verify/${encodeURIComponent(row.session_id)}`,
      };
    }

    // Event root / balance root on checkpoints
    const byCheckpoint = await query(
      `select session_id, sequence, event_root, balance_root, tx_hash
       from session_checkpoints
       where lower(event_root) = lower($1) or lower(balance_root) = lower($1)
       limit 5`,
      [q],
    );
    if (byCheckpoint.rows.length > 0) {
      const row = byCheckpoint.rows[0] as { session_id: string };
      return {
        kind: "checkpoint",
        sessionId: row.session_id,
        matches: byCheckpoint.rows,
        href: `/verify/${encodeURIComponent(row.session_id)}`,
      };
    }

    // Canonical event hash
    const byEvent = await query(
      `select session_id, sequence, event_hash, hand_id, event_type
       from canonical_game_events
       where lower(event_hash) = lower($1)
       limit 5`,
      [q],
    ).catch(() => ({ rows: [] as Record<string, unknown>[] }));
    if (byEvent.rows.length > 0) {
      const row = byEvent.rows[0] as {
        session_id: string;
        hand_id: string | null;
        sequence: string;
        event_hash: string;
      };
      return {
        kind: "event",
        sessionId: row.session_id,
        handId: row.hand_id,
        sequence: row.sequence,
        eventHash: row.event_hash,
        matches: byEvent.rows,
        href: `/verify/${encodeURIComponent(row.session_id)}`,
        handHref: row.hand_id ? `/verify/hand/${encodeURIComponent(row.hand_id)}` : null,
      };
    }

    // Dealer root
    const byDealer = await query(
      `select session_id, dealer_root from dealer_commitments where lower(dealer_root) = lower($1) limit 1`,
      [q],
    );
    if (byDealer.rows[0]) {
      const row = byDealer.rows[0] as { session_id: string };
      return {
        kind: "dealer",
        sessionId: row.session_id,
        href: `/verify/${encodeURIComponent(row.session_id)}`,
      };
    }

    // Settlement proposal roots
    const byProposal = await query(
      `select session_id, event_root, hand_root, balance_root, status
       from settlement_proposals
       where lower(event_root) = lower($1)
          or lower(hand_root) = lower($1)
          or lower(balance_root) = lower($1)
       limit 5`,
      [q],
    );
    if (byProposal.rows.length > 0) {
      const row = byProposal.rows[0] as { session_id: string };
      return {
        kind: "settlement",
        sessionId: row.session_id,
        matches: byProposal.rows,
        href: `/verify/${encodeURIComponent(row.session_id)}`,
      };
    }

    // Proof-batch inclusion (checkpoint root / globalRoot / proofBatchHash)
    const byInclusion = await query(
      `select i.session_id, i.checkpoint_root, i.global_root, i.batch_sequence::text as batch_sequence,
              b.proof_batch_hash
       from proof_batch_inclusion_proofs i
       join proof_batches b on b.id = i.batch_id
       where lower(i.checkpoint_root) = lower($1)
          or lower(i.global_root) = lower($1)
          or lower(b.proof_batch_hash) = lower($1)
       limit 5`,
      [q],
    ).catch(() => ({ rows: [] as Record<string, unknown>[] }));
    if (byInclusion.rows.length > 0) {
      const row = byInclusion.rows[0] as { session_id: string };
      return {
        kind: "proof_batch_inclusion",
        sessionId: row.session_id,
        matches: byInclusion.rows,
        href: `/verify/${encodeURIComponent(row.session_id)}`,
      };
    }

    return reply.code(404).send({ error: "not_found", q });
  });

  app.get("/v1/verify/hand/:handId", async (req, reply) => {
    const handId = (req.params as { handId: string }).handId;
    const key = looksLikeHex(handId) ? normalizeHex(handId) : handId;

    const root = await query(
      `select session_id, hand_id, hand_number, hand_root, created_at
       from hand_roots
       where hand_id = $1 or lower(hand_root) = lower($1)
       limit 1`,
      [key],
    );
    if (!root.rows[0]) return reply.code(404).send({ error: "not_found" });

    const hr = root.rows[0] as {
      session_id: string;
      hand_id: string;
      hand_number: number;
      hand_root: string;
      created_at: string;
    };

    const [events, checkpoint, session] = await Promise.all([
      query(
        `select sequence, event_hash, previous_event_hash, event_type, schema_kind, timestamp_ms
         from canonical_game_events
         where session_id = $1 and hand_id = $2
         order by sequence
         limit 200`,
        [hr.session_id, hr.hand_id],
      ).catch(() => ({ rows: [] as Record<string, unknown>[] })),
      query(
        `select sequence, event_root, balance_root, randomness_epoch, tx_hash
         from session_checkpoints
         where session_id = $1 and hand_number = $2
         order by sequence desc
         limit 1`,
        [hr.session_id, hr.hand_number],
      ),
      loadSessionPayload(hr.session_id),
    ]);

    return {
      workPacket: "WP-090",
      handId: hr.hand_id,
      handNumber: hr.hand_number,
      handRoot: hr.hand_root,
      createdAt: hr.created_at,
      sessionId: hr.session_id,
      checkpoint: checkpoint.rows[0] ?? null,
      events: events.rows,
      session: session
        ? {
            result: session.result,
            status: session.status,
            components: session.components,
            hashes: session.hashes,
            settlement: session.settlement,
            vrf: session.vrf,
            chainId: session.chainId,
            chainName: session.chainName,
            contracts: session.contracts,
            localVerify: session.localVerify,
            proofBatchInclusion: session.proofBatchInclusion,
          }
        : null,
      href: `/verify/hand/${encodeURIComponent(hr.hand_id)}`,
      sessionHref: `/verify/${encodeURIComponent(hr.session_id)}`,
    };
  });

  /** Public event tip for a session (hashes + types only). */
  app.get("/v1/verify/session/:sessionId/events", async (req, reply) => {
    const sessionId = (req.params as { sessionId: string }).sessionId;
    const limit = Math.min(Number((req.query as { limit?: string }).limit ?? 50), 200);
    const exists = await query(`select 1 from onchain_sessions where session_id = $1`, [sessionId]);
    if (!exists.rows[0]) return reply.code(404).send({ error: "not_found" });

    const rows = await query(
      `select sequence, event_hash, previous_event_hash, event_type, hand_id, hand_number,
              schema_kind, resulting_state_hash, timestamp_ms
       from canonical_game_events
       where session_id = $1
       order by sequence
       limit $2`,
      [sessionId, limit],
    ).catch(() => ({ rows: [] as Record<string, unknown>[] }));

    return {
      sessionId,
      count: rows.rows.length,
      events: rows.rows,
      note: "Public hashes only. Private dealer openings are not exposed on this route.",
    };
  });

  // Plan 19 path aliases (plural /sessions + package + proof-batch sequence).
  app.get("/v1/verify/sessions/:sessionId", async (req, reply) => {
    const sessionId = (req.params as { sessionId: string }).sessionId;
    const payload = await loadSessionPayload(sessionId);
    if (!payload) return reply.code(404).send({ error: "not_found" });
    return payload;
  });

  app.get("/v1/verify/sessions/:sessionId/package", async (req, reply) => {
    const sessionId = (req.params as { sessionId: string }).sessionId;
    const pkg = await query(
      `select package_id, content_hash, status, chain_id, proof_batch_sequence, tx_hash,
              package_json, published_at, created_at
       from verification_packages
       where session_id = $1 and status = 'published'
       order by published_at desc nulls last
       limit 1`,
      [sessionId],
    ).catch(() => ({ rows: [] as Record<string, unknown>[] }));

    if (pkg.rows[0]) {
      return { sessionId, source: "verification_packages", package: pkg.rows[0] };
    }

    // Fallback: reconstruct a minimal public package from proof_batches inclusion + session tip.
    const session = await loadSessionPayload(sessionId);
    if (!session) return reply.code(404).send({ error: "not_found" });
    const inclusion = await listInclusionProofsForSession(sessionId);
    return {
      sessionId,
      source: "derived",
      package: {
        packageId: `derived:${sessionId}`,
        session,
        proofBatchInclusion: inclusion,
        note: "No published verification_packages row; derived from live projections.",
      },
    };
  });

  app.get("/v1/verify/proof-batches/:sequence", async (req, reply) => {
    const sequence = (req.params as { sequence: string }).sequence;
    const batch = await query(
      `select sequence::text, previous_batch_root, global_root, data_manifest_hash,
              proof_batch_hash, created_at_chain::text, tx_hash, package_json, created_at
       from proof_batches where sequence = $1::bigint`,
      [sequence],
    ).catch(() => ({ rows: [] as Record<string, unknown>[] }));
    if (!batch.rows[0]) return reply.code(404).send({ error: "not_found" });

    const inclusions = await query(
      `select session_id, checkpoint_id::text, checkpoint_root, leaf_index, merkle_proof,
              global_root, verified_locally
       from proof_batch_inclusion_proofs
       where batch_sequence = $1::bigint
       order by leaf_index`,
      [sequence],
    ).catch(() => ({ rows: [] as Record<string, unknown>[] }));

    return {
      batch: batch.rows[0],
      inclusionProofs: inclusions.rows,
    };
  });
}
