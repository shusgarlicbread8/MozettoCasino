/**
 * Settlement + checkpoint worker (Phases 3/5/7) — WP-084.
 * - V3 path (additive): FinalSettlementV3 via @mozetto/root-builder + @mozetto/attestors → Hub V3
 * - V2 path (legacy Anvil demos): FinalSettlement EIP-712 "2" → PokerSettlementHubV2
 * Mode: SETTLEMENT_HUB_V3_ADDRESS set, or SETTLEMENT_HUB_VERSION=v3|v2
 */
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import type { Hex } from "viem";
import { probeAttestorKeys, tryLoadAttestorKey } from "@mozetto/attestors";
import { query } from "@mozetto/database";
import { requestDealerAttestation } from "@mozetto/dealer/client";
import {
  chainClients,
  keccakLike,
  resolveSettlementMode,
  sessionIdToBytes32,
  toBytes32,
} from "./chain.js";
import { startHealthServer } from "./health.js";
import { maybeRateOnchainSession } from "./rating.js";
import {
  anchorCheckpointsOnchain,
  emitSessionCheckpoints,
} from "./checkpoints.js";
import { processOnchainSettlementsV3 } from "./v3/process.js";

const RANDOMNESS_ABI = [
  {
    type: "function",
    name: "commitSeedBatch",
    stateMutability: "nonpayable",
    inputs: [
      { name: "epochId", type: "bytes32" },
      { name: "secretSeedRoot", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "fulfillMock",
    stateMutability: "nonpayable",
    inputs: [
      { name: "epochId", type: "bytes32" },
      { name: "vrfWord", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

/** Legacy Hub V2 ABI — kept for Anvil demos when SETTLEMENT_HUB_VERSION=v2. */
const SETTLEMENT_HUB_ABI = [
  {
    type: "function",
    name: "settle",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "settlement",
        type: "tuple",
        components: [
          { name: "sessionId", type: "bytes32" },
          { name: "finalSequence", type: "uint64" },
          { name: "eventRoot", type: "bytes32" },
          { name: "handRoot", type: "bytes32" },
          { name: "balanceRoot", type: "bytes32" },
          { name: "totalRake", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      {
        name: "players",
        type: "tuple[]",
        components: [
          { name: "user", type: "address" },
          { name: "startLocked", type: "uint256" },
          { name: "endBalance", type: "uint256" },
        ],
      },
      { name: "signatures", type: "bytes[]" },
    ],
    outputs: [],
  },
] as const;

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

function hubDomainV2(chainId: number, verifyingContract: Hex) {
  return {
    name: "MozettoPokerSettlement",
    version: "2",
    chainId,
    verifyingContract,
  } as const;
}

async function tickPending() {
  const pending = await query(`select count(*)::int as n from settlements where status = 'pending'`).catch(
    () => ({ rows: [{ n: 0 }] }),
  );
  console.log("[settlement-worker] pending settlements", pending.rows[0]?.n ?? 0);
}

/**
 * Local / Anvil only. On Base Sepolia or mainnet, RandomnessCoordinator should
 * request Chainlink VRF and fulfill via coordinator callback — not fulfillMock.
 */
async function mockVrfEpoch() {
  const coord = process.env.RANDOMNESS_COORDINATOR_ADDRESS as Hex | undefined;
  const pk = (process.env.SETTLEMENT_PRIVATE_KEY || process.env.GAME_ATTESTOR_PRIVATE_KEY) as Hex | undefined;
  if (!coord || !pk || process.env.ENABLE_MOCK_VRF !== "1") return;

  const { wallet } = chainClients(pk);
  const epochId = keccakLike(`epoch:${new Date().toISOString().slice(0, 13)}`);
  const seedRoot = keccakLike(`seeds:${epochId}:${Math.random()}`);
  try {
    await wallet.writeContract({
      address: coord,
      abi: RANDOMNESS_ABI,
      functionName: "commitSeedBatch",
      args: [epochId, seedRoot],
    });
    const word = BigInt(`0x${createHash("sha256").update(seedRoot).digest("hex")}`);
    await wallet.writeContract({
      address: coord,
      abi: RANDOMNESS_ABI,
      functionName: "fulfillMock",
      args: [epochId, word],
    });
    console.log("[settlement-worker] mock VRF epoch (ENABLE_MOCK_VRF=1)", epochId);
  } catch (e) {
    console.warn("[settlement-worker] mock VRF", e instanceof Error ? e.message : e);
  }
}

type SessionRow = {
  session_id: string;
  table_id: string | null;
  chain_id: number;
};

async function buildProposalV2(session: SessionRow) {
  type StackRow = {
    wallet_address: string;
    stack: string;
    buy_in: string;
    owner_id: string;
    agent_id: string;
  };
  let stacks: { rows: StackRow[] };
  try {
    stacks = await query<StackRow>(
      `select osp.wallet_address,
              coalesce(ts.stack, (osp.buy_in_raw::numeric / 1000000))::text as stack,
              coalesce(ts.buy_in, (osp.buy_in_raw::numeric / 1000000))::text as buy_in,
              coalesce(ts.owner_id::text, osp.profile_id::text, '') as owner_id,
              coalesce(ts.agent_id::text, '') as agent_id
       from onchain_session_players osp
       left join lateral (
         select stack, buy_in, owner_id, agent_id
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
  } catch (e) {
    console.warn(
      "[settlement-worker] stack query failed",
      session.session_id,
      e instanceof Error ? e.message : e,
    );
    stacks = { rows: [] };
  }

  if (!stacks.rows.length) {
    console.log("[settlement-worker] skip proposal — no ending stacks", session.session_id, "table", session.table_id);
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

  // WP-108: refuse keccak stub roots when REQUIRE_REAL_ROOTS / MOZETTO_GOLDEN.
  const { resolveSettlementRoots, StubRootError, requireRealRoots } = await import(
    "./v3/real-roots.js"
  );
  let eventRoot: Hex;
  let handRoot: Hex;
  let balanceRoot: Hex;
  try {
    const roots = resolveSettlementRoots({
      sessionId: session.session_id,
      storedEventRoot: canonical.rows[0]?.event_hash,
      storedHandRoot: handRootRow.rows[0]?.hand_root,
      finalSequence,
    });
    eventRoot = roots.finalEventRoot;
    handRoot = roots.handRoot;
    balanceRoot = roots.balanceRoot;
    if (roots.usedStub) {
      console.warn(
        "[settlement-worker] using stub roots (set REQUIRE_REAL_ROOTS=1 to hard-fail)",
        session.session_id,
      );
    }
  } catch (e) {
    if (e instanceof StubRootError || requireRealRoots()) {
      console.error(
        "[settlement-worker] real roots required — skip proposal",
        session.session_id,
        e instanceof Error ? e.message : e,
      );
      return null;
    }
    throw e;
  }

  const balances: Record<string, number> = {};
  let startTotal = 0;
  let endTotal = 0;
  for (const row of stacks.rows) {
    const start = Number(row.buy_in);
    const end = Number(row.stack);
    balances[row.wallet_address] = end;
    startTotal += start;
    endTotal += end;
  }
  const totalRake = Math.max(0, startTotal - endTotal);

  const deadline = new Date(Date.now() + 86400_000);
  const insert = await query<{ id: string }>(
    `insert into settlement_proposals
     (session_id, final_sequence, event_root, hand_root, balance_root, total_rake, balances, deadline, status)
     values ($1,$2,$3,$4,$5,$6,$7,$8,'proposed')
     returning id`,
    [
      session.session_id,
      finalSequence.toString(),
      eventRoot,
      handRoot,
      balanceRoot,
      totalRake,
      JSON.stringify(balances),
      deadline.toISOString(),
    ],
  ).catch(() => ({ rows: [] as { id: string }[] }));

  const proposalId = insert.rows[0]?.id;
  if (!proposalId) return null;
  return {
    proposalId,
    sessionId: session.session_id,
    finalSequence,
    eventRoot,
    handRoot,
    balanceRoot,
    totalRake,
    deadline: Math.floor(deadline.getTime() / 1000),
    balances,
  };
}

async function collectAttestationsV2(proposal: NonNullable<Awaited<ReturnType<typeof buildProposalV2>>>) {
  const hub = process.env.SETTLEMENT_HUB_ADDRESS as Hex | undefined;
  const gameKey = tryLoadAttestorKey("game");
  const gamePk = gameKey?.privateKey;
  const replayUrl = process.env.REPLAY_VERIFIER_URL ?? "http://localhost:4004";
  const signatures: Hex[] = [];
  const roles: ("game" | "replay" | "dealer")[] = [];

  if (gamePk && hub) {
    const { account, wallet, chainId } = chainClients(gamePk);
    const sig = await wallet.signTypedData({
      domain: hubDomainV2(chainId, hub),
      types: {
        FinalSettlement: [
          { name: "sessionId", type: "bytes32" },
          { name: "finalSequence", type: "uint64" },
          { name: "eventRoot", type: "bytes32" },
          { name: "handRoot", type: "bytes32" },
          { name: "balanceRoot", type: "bytes32" },
          { name: "totalRake", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      primaryType: "FinalSettlement",
      message: {
        sessionId: sessionIdToBytes32(proposal.sessionId),
        finalSequence: proposal.finalSequence,
        eventRoot: proposal.eventRoot,
        handRoot: proposal.handRoot,
        balanceRoot: proposal.balanceRoot,
        totalRake: BigInt(Math.floor(proposal.totalRake * 1e6)),
        deadline: BigInt(proposal.deadline),
      },
    });
    signatures.push(sig);
    roles.push("game");
    await query(
      `insert into settlement_attestations (proposal_id, attestor_role, attestor_address, signature)
       values ($1,'game',$2,$3) on conflict (proposal_id, attestor_role) do nothing`,
      [proposal.proposalId, account.address, sig],
    ).catch(() => null);
  }

  try {
    const res = await fetch(`${replayUrl.replace(/\/$/, "")}/v1/verify-session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: proposal.sessionId }),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) {
      const body = (await res.json()) as { ok?: boolean; signature?: string; attestorAddress?: string };
      if (body.ok && body.signature) {
        signatures.push(body.signature as Hex);
        roles.push("replay");
        await query(
          `insert into settlement_attestations (proposal_id, attestor_role, attestor_address, signature)
           values ($1,'replay',$2,$3) on conflict (proposal_id, attestor_role) do nothing`,
          [proposal.proposalId, body.attestorAddress ?? "replay", body.signature],
        ).catch(() => null);
      }
    }
  } catch (e) {
    console.warn("[settlement-worker] replay attestation failed", e instanceof Error ? e.message : e);
  }

  const dealer = await requestDealerAttestation({
    sessionId: proposal.sessionId,
    finalSequence: Number(proposal.finalSequence),
    eventRoot: proposal.eventRoot,
    handRoot: proposal.handRoot,
    balanceRoot: proposal.balanceRoot,
    totalRake: String(Math.floor(proposal.totalRake * 1e6)),
    deadline: proposal.deadline,
  });
  if (dealer?.signature) {
    signatures.push(dealer.signature as Hex);
    roles.push("dealer");
    await query(
      `insert into settlement_attestations (proposal_id, attestor_role, attestor_address, signature)
       values ($1,'dealer',$2,$3) on conflict (proposal_id, attestor_role) do nothing`,
      [proposal.proposalId, dealer.attestorAddress, dealer.signature],
    ).catch(() => null);
  }

  return { signatures, roles };
}

async function submitHubSettlementV2(
  proposal: NonNullable<Awaited<ReturnType<typeof buildProposalV2>>>,
  signatures: Hex[],
  hub: Hex,
) {
  const pk = process.env.SETTLEMENT_PRIVATE_KEY as Hex | undefined;
  if (!pk || signatures.length < 2) {
    console.log(
      "[settlement-worker] quorum incomplete",
      proposal.sessionId,
      `${signatures.length}/2 signatures`,
    );
    return;
  }

  const players = await query<{ wallet_address: string; stack: string; buy_in_raw: string }>(
    `select osp.wallet_address,
            coalesce(
              (
                select ts.stack::text from table_sessions ts
                join onchain_sessions os on os.table_id = ts.table_id
                where os.session_id = osp.session_id and ts.owner_id = osp.profile_id
                order by case when ts.status = 'active' then 0 else 1 end,
                         coalesce(ts.ended_at, ts.started_at) desc nulls last
                limit 1
              ),
              (osp.buy_in_raw::numeric / 1000000)::text
            ) as stack,
            osp.buy_in_raw::text as buy_in_raw
     from onchain_session_players osp where session_id = $1`,
    [proposal.sessionId],
  ).catch(() => ({ rows: [] as { wallet_address: string; stack: string; buy_in_raw: string }[] }));

  const settlementPlayers = players.rows.map((p) => {
    const startLocked = BigInt(p.buy_in_raw);
    const endBalance = BigInt(Math.floor(Number(p.stack) * 1e6));
    return {
      user: p.wallet_address as `0x${string}`,
      startLocked,
      endBalance,
    };
  });

  const { wallet, publicClient } = chainClients(pk);
  try {
    const hash = await wallet.writeContract({
      address: hub,
      abi: SETTLEMENT_HUB_ABI,
      functionName: "settle",
      args: [
        {
          sessionId: sessionIdToBytes32(proposal.sessionId),
          finalSequence: proposal.finalSequence,
          eventRoot: proposal.eventRoot,
          handRoot: proposal.handRoot,
          balanceRoot: proposal.balanceRoot,
          totalRake: BigInt(Math.floor(proposal.totalRake * 1e6)),
          deadline: BigInt(proposal.deadline),
        },
        settlementPlayers,
        signatures.slice(0, 3),
      ],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    await query(
      `update settlement_proposals set status = 'submitted' where id = $1`,
      [proposal.proposalId],
    ).catch(() => null);
    await query(
      `update onchain_sessions set status = 'settled', settlement_tx_hash = $2, settled_at = now() where session_id = $1`,
      [proposal.sessionId, hash],
    ).catch(() => null);
    console.log("[settlement-worker] hub V2 settle submitted", proposal.sessionId, hash);

    const vault = process.env.ARENA_VAULT_ADDRESS as Hex | undefined;
    if (vault) {
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
        console.log("[settlement-worker] protocol fees deposited to fee vault", fees.toString(), feeHash);
      }
    }

    await maybeRateOnchainSession(proposal.sessionId, proposal.balances).catch((e) =>
      console.warn("[settlement-worker] rated match skip", e),
    );
  } catch (e) {
    console.warn("[settlement-worker] hub settle failed", proposal.sessionId, e instanceof Error ? e.message : e);
    await query(`update settlement_proposals set status = 'rejected' where id = $1`, [
      proposal.proposalId,
    ]).catch(() => null);
  }
}

async function processOnchainSettlementsV2(hub: Hex) {
  const pk = process.env.SETTLEMENT_PRIVATE_KEY as Hex | undefined;
  if (!pk) return;

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
       )
     order by created_at asc
     limit 5`,
  ).catch(() => ({ rows: [] as SessionRow[] }));

  for (const session of sessions.rows) {
    const existing = await query(
      `select id from settlement_proposals where session_id = $1 and status in ('proposed','attesting','submitted') limit 1`,
      [session.session_id],
    );
    if (existing.rows[0]) {
      console.log("[settlement-worker] proposal already exists", session.session_id);
      continue;
    }
    const proposal = await buildProposalV2(session);
    if (!proposal) continue;
    await query(`update onchain_sessions set status = 'settling' where session_id = $1`, [session.session_id]).catch(
      () => null,
    );
    const { signatures } = await collectAttestationsV2(proposal);
    await submitHubSettlementV2(proposal, signatures, hub);
  }
}

const { mode, hubAddress } = resolveSettlementMode();
console.log(
  `[settlement-worker] running — mode=${mode} hub=${hubAddress ?? "(unset)"} — quorum settle + checkpoints + mock VRF when configured`,
);

try {
  const probe = probeAttestorKeys();
  for (const k of probe.loaded) {
    console.log(`[settlement-worker] attestor role=${k.role} address=${k.address}`);
  }
  if (probe.duplicateError) {
    console.warn("[settlement-worker] attestor key collision:", probe.duplicateError.message);
  }
} catch (e) {
  console.error("[settlement-worker] attestor key check failed", e instanceof Error ? e.message : e);
  throw e;
}

async function loop() {
  await tickPending();
  if (hubAddress) {
    if (mode === "v3") {
      await processOnchainSettlementsV3(hubAddress).catch((e) => console.error(e));
    } else {
      await processOnchainSettlementsV2(hubAddress).catch((e) => console.error(e));
    }
  }
  // WP-112: SQL session_checkpoints → proof-batch publisher CheckpointSource
  await emitSessionCheckpoints().catch((e) => console.error(e));
  await anchorCheckpointsOnchain().catch((e) => console.error(e));
  await mockVrfEpoch().catch((e) => console.error(e));
}

const isMain =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const SETTLEMENT_HEALTH_PORT = Number(
    process.env.PORT ?? process.env.SETTLEMENT_HEALTH_PORT ?? 4011,
  );
  if (process.env.SETTLEMENT_HEALTH !== "0") {
    startHealthServer(SETTLEMENT_HEALTH_PORT);
  }

  const SETTLEMENT_POLL_MS = Number(process.env.SETTLEMENT_POLL_MS || 15_000);
  setInterval(() => {
    loop().catch(console.error);
  }, SETTLEMENT_POLL_MS);
  loop().catch(console.error);
}
