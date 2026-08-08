import { query } from "@mozetto/database";
import type { Address, Hex } from "viem";
import { chainClients, sessionIdToBytes32 } from "../chain.js";
import {
  buildV3Proposal,
  collectV3Attestations,
  defaultV3HttpAdapters,
  submitHubSettlementV3,
  toHubSettlementArg,
  type V3Proposal,
} from "./index.js";
import {
  balanceLeavesFromPlayers,
  requireRealRoots,
  resolveSettlementRoots,
  StubRootError,
} from "./real-roots.js";
import { maybeRateOnchainSession } from "../rating.js";

/** ArenaVaultV2 `sessions(bytes32)` — openedAt is 0 when the vault never opened this id. */
const ARENA_VAULT_SESSION_ABI = [
  {
    type: "function",
    name: "sessions",
    stateMutability: "view",
    inputs: [{ name: "sessionId", type: "bytes32" }],
    outputs: [
      { name: "sessionId", type: "bytes32" },
      { name: "templateId", type: "bytes32" },
      { name: "dealerRoot", type: "bytes32" },
      { name: "engineHash", type: "bytes32" },
      { name: "profileSetHash", type: "bytes32" },
      { name: "openedAt", type: "uint64" },
      { name: "settled", type: "bool" },
      { name: "lastSequence", type: "uint64" },
      { name: "lastBalanceRoot", type: "bytes32" },
      { name: "emergencyExitAfter", type: "uint64" },
    ],
  },
] as const;

/** True when the configured vault has no record of this session id. */
async function isUnknownOnChain(session: { session_id: string }): Promise<boolean> {
  const vault = process.env.ARENA_VAULT_ADDRESS as Hex | undefined;
  const pk = process.env.SETTLEMENT_PRIVATE_KEY as Hex | undefined;
  if (!vault || !pk) return false;
  try {
    const { publicClient } = chainClients(pk);
    const row = (await publicClient.readContract({
      address: vault,
      abi: ARENA_VAULT_SESSION_ABI,
      functionName: "sessions",
      args: [sessionIdToBytes32(session.session_id)],
    })) as readonly unknown[];
    return BigInt((row[5] as bigint | number | string) ?? 0) === 0n;
  } catch {
    // Never void on a transport error — only on a definite on-chain answer.
    return false;
  }
}

const ARENA_VAULT_FEE_ABI = [
  {
    type: "function",
    name: "accruedProtocolFees",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "withdrawProtocolFees",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
] as const;

export type SessionRow = {
  session_id: string;
  table_id: string | null;
  chain_id: number;
};

type StackRow = {
  wallet_address: string;
  stack: string;
  buy_in: string;
  buy_in_raw: string;
  owner_id: string;
  agent_id: string;
  seat: number | null;
};

async function loadStacks(session: SessionRow): Promise<StackRow[]> {
  try {
    const stacks = await query<StackRow>(
      `select osp.wallet_address,
              coalesce(ts.stack, (osp.buy_in_raw::numeric / 1000000))::text as stack,
              coalesce(ts.buy_in, (osp.buy_in_raw::numeric / 1000000))::text as buy_in,
              osp.buy_in_raw::text as buy_in_raw,
              coalesce(ts.owner_id::text, osp.profile_id::text, '') as owner_id,
              coalesce(ts.agent_id::text, '') as agent_id,
              ts.seat
       from onchain_session_players osp
       left join lateral (
         select stack, buy_in, owner_id, agent_id, seat
         from table_sessions
         where ($2::text is not null)
           and table_id = $2
           and owner_id = osp.profile_id
         order by case when status = 'active' then 0 else 1 end,
                  coalesce(ended_at, started_at) desc nulls last
         limit 1
       ) ts on true
       where osp.session_id = $1`,
      [session.session_id, session.table_id],
    );
    return stacks.rows;
  } catch (e) {
    console.warn(
      "[settlement-worker:v3] stack query failed",
      session.session_id,
      e instanceof Error ? e.message : e,
    );
    return [];
  }
}

export async function buildProposalV3FromDb(
  session: SessionRow,
  hub: Hex,
  chainId: number,
): Promise<{ proposalId: string; v3: V3Proposal } | null> {
  const stacks = await loadStacks(session);
  if (!stacks.length) {
    console.log(
      "[settlement-worker:v3] skip proposal — no ending stacks",
      session.session_id,
      "table",
      session.table_id,
    );
    return null;
  }

  const canonical = await query<{ sequence: string; event_hash: string }>(
    `select sequence::text, event_hash from canonical_game_events
     where session_id = $1 order by sequence desc limit 1`,
    [session.session_id],
  ).catch(() => ({ rows: [] as { sequence: string; event_hash: string }[] }));

  const finalSequence = BigInt(canonical.rows[0]?.sequence ?? 0);

  const handRootRow = await query<{ hand_root: string }>(
    `select hand_root from hand_roots where session_id = $1 order by created_at desc limit 1`,
    [session.session_id],
  ).catch(() => ({ rows: [] as { hand_root: string }[] }));

  const checkpointBal = await query<{ balance_root: string }>(
    `select balance_root from session_checkpoints
     where session_id = $1 order by sequence desc limit 1`,
    [session.session_id],
  ).catch(() => ({ rows: [] as { balance_root: string }[] }));

  // Abandoned before play: no hand was ever dealt, so no chips moved and there
  // is no hand root to have. Refunding at the buy-in is what releases the
  // vault lock and the ArenaAccount's concurrent-game slot — an unsettled
  // session strands the player's funds and eventually locks them out entirely.
  const dealt = await query<{ n: string }>(
    `select count(*)::text as n from hands where table_id = $1`,
    [session.table_id],
  ).catch(() => ({ rows: [{ n: "0" }] }));
  const noPlay = Number(dealt.rows[0]?.n ?? 0) === 0;

  const players = stacks.map((row, i) => {
    const startLocked = BigInt(row.buy_in_raw);
    const endBalance = noPlay ? startLocked : BigInt(Math.floor(Number(row.stack) * 1e6));
    return {
      user: row.wallet_address as Address,
      seat: row.seat != null ? Number(row.seat) : i,
      startLocked,
      endBalance,
    };
  });

  let roots;
  try {
    roots = resolveSettlementRoots({
      sessionId: session.session_id,
      storedEventRoot: canonical.rows[0]?.event_hash,
      storedHandRoot: handRootRow.rows[0]?.hand_root,
      storedBalanceRoot: checkpointBal.rows[0]?.balance_root,
      finalSequence,
      noPlay,
      balanceLeaves: balanceLeavesFromPlayers({
        sessionId: sessionIdToBytes32(session.session_id),
        finalSequence,
        players,
      }),
    });
    if (roots.usedStub) {
      console.warn(
        "[settlement-worker:v3] using stub roots (set REQUIRE_REAL_ROOTS=1 to hard-fail)",
        session.session_id,
      );
    }
  } catch (e) {
    if (e instanceof StubRootError || requireRealRoots()) {
      console.error(
        "[settlement-worker:v3] real roots required — skip proposal",
        session.session_id,
        e instanceof Error ? e.message : e,
      );
      return null;
    }
    console.warn(
      "[settlement-worker:v3] root resolve failed",
      session.session_id,
      e instanceof Error ? e.message : e,
    );
    return null;
  }

  let v3: V3Proposal;
  try {
    v3 = buildV3Proposal({
      sessionId: session.session_id,
      finalSequence,
      finalEventRoot: roots.finalEventRoot,
      handRoot: roots.handRoot,
      players,
      balanceRoot: roots.balanceRoot,
      chainId: BigInt(chainId),
      verifyingContract: hub,
    });
  } catch (e) {
    console.warn(
      "[settlement-worker:v3] proposal build failed",
      session.session_id,
      e instanceof Error ? e.message : e,
    );
    return null;
  }

  const deadlineIso = new Date(Number(v3.settlement.deadline) * 1000).toISOString();
  const insert = await query<{ id: string }>(
    `insert into settlement_proposals
     (session_id, final_sequence, event_root, hand_root, balance_root, total_rake, balances, deadline, status)
     values ($1,$2,$3,$4,$5,$6,$7,$8,'proposed')
     returning id`,
    [
      session.session_id,
      finalSequence.toString(),
      v3.settlement.finalEventRoot,
      v3.settlement.handRoot,
      v3.settlement.balanceRoot,
      Number(v3.totalRake) / 1e6,
      JSON.stringify({
        ...v3.balancesChip,
        _v3: {
          digest: v3.digests.digest,
          openingTotal: v3.openingTotal.toString(),
          endingPlayerTotal: v3.endingPlayerTotal.toString(),
          totalRake: v3.totalRake.toString(),
          randomnessEpochId: v3.settlement.randomnessEpochId,
          proofBatchSequence: v3.settlement.proofBatchSequence.toString(),
        },
      }),
      deadlineIso,
    ],
  ).catch(() => ({ rows: [] as { id: string }[] }));

  const proposalId = insert.rows[0]?.id;
  if (!proposalId) return null;
  return { proposalId, v3 };
}

export async function processOnchainSettlementsV3(hub: Hex) {
  const pk = process.env.SETTLEMENT_PRIVATE_KEY as Hex | undefined;
  if (!pk) {
    console.warn("[settlement-worker:v3] SETTLEMENT_PRIVATE_KEY unset — skip submit path");
    return;
  }

  const chainId = Number(process.env.CHAIN_ID || 84532);
  const sessions = await query<SessionRow>(
    `select session_id, table_id, chain_id from onchain_sessions os
     where settlement_tx_hash is null
       and not exists (
         select 1 from table_sessions active
         where active.table_id = os.table_id and active.status = 'active'
       )
       and (
         status in ('playing', 'settling')
         or (
           status = 'opened'
           and table_id is not null
           and exists (
             select 1 from table_sessions ts
             where ts.table_id = os.table_id and ts.status = 'completed'
           )
         )
         -- Abandoned sessions still hold the on-chain lock. Until they settle,
         -- the player's ArenaAccount keeps the buy-in at risk and burns one of
         -- its maxConcurrentGames slots, so the account eventually cannot join
         -- any match at all. 'blocked' is a DB verdict, not an on-chain one.
         or (
           status in ('blocked', 'pending', 'opened', 'settling')
           and created_at < now() - interval '2 minutes'
           and exists (
             select 1 from onchain_session_players osp
             where osp.session_id = os.session_id
           )
           and not exists (
             select 1 from table_sessions active
             where active.table_id = os.table_id and active.status = 'active'
           )
         )
       )
     -- Prefer sessions that are not pinned by a fresh in-flight proposal, and
     -- prefer recent leaves so a player is not locked out of Find Match.
     order by
       case when exists (
         select 1 from settlement_proposals sp
         where sp.session_id = os.session_id
           and sp.status in ('proposed','attesting','submitted')
           and sp.created_at >= now() - interval '90 seconds'
       ) then 1 else 0 end asc,
       os.created_at desc
     limit 8`,
  ).catch(() => ({ rows: [] as SessionRow[] }));

  for (const session of sessions.rows) {
    // A session the vault has never heard of cannot be settled and holds no
    // on-chain funds — it is a DB row left behind by an earlier deployment
    // (an Anvil redeploy, typically). Retire it, otherwise the oldest ghosts
    // permanently occupy this batch and real settlements never get processed.
    if (await isUnknownOnChain(session)) {
      // status check constraint forbids arbitrary values like 'void'. Mark the
      // row settled with a sentinel tx hash so it never re-enters this queue
      // (settlement_tx_hash IS NULL is the selection gate).
      await query(
        `update onchain_sessions
         set status = 'settled',
             settlement_tx_hash = '0x00000000000000000000000000000000000000000000000000000000000000ff'
         where session_id = $1 and settlement_tx_hash is null`,
        [session.session_id],
      ).catch((err) => console.warn("[settlement-worker:v3] ghost retire failed", session.session_id, err));
      console.warn("[settlement-worker:v3] retired ghost session unknown to the vault", session.session_id);
      continue;
    }

    // Stale in-flight proposals used to block the whole FIFO forever:
    // leave → settling → "proposal already exists" → activeGames never released.
    await query(
      `update settlement_proposals
       set status = 'rejected'
       where session_id = $1
         and status in ('proposed', 'attesting', 'submitted')
         and created_at < now() - interval '90 seconds'`,
      [session.session_id],
    ).catch(() => null);

    const existing = await query<{ id: string }>(
      `select id from settlement_proposals
       where session_id = $1 and status in ('proposed','attesting','submitted')
       order by created_at desc limit 1`,
      [session.session_id],
    );
    if (existing.rows[0]) {
      // Fresh proposal from a parallel tick — let the next loop pick it up after
      // the 90s stale window, but do not starve younger sessions forever.
      console.log(
        "[settlement-worker:v3] fresh proposal in flight — skip for now",
        session.session_id,
        existing.rows[0].id,
      );
      continue;
    }

    const built = await buildProposalV3FromDb(session, hub, session.chain_id || chainId);
    if (!built) continue;

    await query(`update onchain_sessions set status = 'settling' where session_id = $1`, [
      session.session_id,
    ]).catch(() => null);

    const { attestations, signatures } = await collectV3Attestations({
      settlement: built.v3.settlement,
      httpAdapters: defaultV3HttpAdapters(),
    });

    for (const att of attestations) {
      await query(
        `insert into settlement_attestations (proposal_id, attestor_role, attestor_address, signature)
         values ($1,$2,$3,$4) on conflict (proposal_id, attestor_role) do nothing`,
        [built.proposalId, att.role, att.address, att.signature],
      ).catch(() => null);
    }

    try {
      const result = await submitHubSettlementV3({
        hub,
        submitterPk: pk,
        settlement: toHubSettlementArg(built.v3.settlement),
        players: built.v3.players,
        signatures,
      });
      if (!result) {
        continue;
      }

      await query(`update settlement_proposals set status = 'confirmed' where id = $1`, [
        built.proposalId,
      ]).catch(() => null);
      await query(
        `update onchain_sessions set status = 'settled', settlement_tx_hash = $2, settled_at = now() where session_id = $1`,
        [session.session_id, result.txHash],
      ).catch(() => null);
      console.log(
        "[settlement-worker:v3] hub settle confirmed",
        session.session_id,
        result.txHash,
        "digest",
        built.v3.digests.digest,
      );

      const vault = process.env.ARENA_VAULT_ADDRESS as Hex | undefined;
      if (vault) {
        const { wallet, publicClient } = chainClients(pk);
        const fees = await publicClient.readContract({
          address: vault,
          abi: ARENA_VAULT_FEE_ABI,
          functionName: "accruedProtocolFees",
        });
        if (fees > 0n) {
          const feeHash = await wallet.writeContract({
            address: vault,
            abi: ARENA_VAULT_FEE_ABI,
            functionName: "withdrawProtocolFees",
            args: [fees],
          });
          await publicClient.waitForTransactionReceipt({ hash: feeHash });
          console.log("[settlement-worker:v3] protocol fees deposited", fees.toString(), feeHash);
        }
      }

      await maybeRateOnchainSession(
        session.session_id,
        built.v3.balancesChip,
        built.v3.digests.digest,
      ).catch((e) => console.warn("[settlement-worker:v3] rated match skip", e));
    } catch (e) {
      console.warn(
        "[settlement-worker:v3] hub settle failed",
        session.session_id,
        e instanceof Error ? e.message : e,
      );
      await query(`update settlement_proposals set status = 'rejected' where id = $1`, [
        built.proposalId,
      ]).catch(() => null);
    }
  }
}
