/**
 * Settlement + checkpoint worker (Phases 3/5/7).
 * - Tracks pending settlements
 * - Builds settlement proposals + 2-of-3 attestations (game / replay / dealer)
 * - Submits PokerSettlementHub.settle when configured
 * - Anchors hand-event Merkle roots into CheckpointRegistry when configured
 * - Mock VRF: call fulfillMock when ENABLE_MOCK_VRF=1 (local Anvil only).
 *   Production: wire Chainlink VRF via RandomnessCoordinator.requestRandomWords +
 *   fulfillRandomWords callback — do not use fulfillMock on mainnet/testnet.
 */
import { createHash } from "node:crypto";
import {
  createWalletClient,
  createPublicClient,
  http,
  keccak256,
  toBytes,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia, foundry } from "viem/chains";
import { query, settleRatedMatch } from "@mozetto/database";
import { requestDealerAttestation } from "@mozetto/dealer/client";

const CHECKPOINT_ABI = [
  {
    type: "function",
    name: "anchor",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "cp",
        type: "tuple",
        components: [
          { name: "tableId", type: "bytes32" },
          { name: "epoch", type: "uint256" },
          { name: "lastEventSequence", type: "uint256" },
          { name: "handsRoot", type: "bytes32" },
          { name: "balancesRoot", type: "bytes32" },
          { name: "timestamp", type: "uint64" },
          { name: "attestationHash", type: "bytes32" },
        ],
      },
    ],
    outputs: [],
  },
] as const;

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

function keccakLike(data: string): Hex {
  return (`0x${createHash("sha256").update(data).digest("hex")}`) as Hex;
}

function sessionIdToBytes32(sessionId: string): Hex {
  // Custody session ids are already bytes32 hex from openSession — do not re-hash.
  if (/^0x[0-9a-fA-F]{64}$/.test(sessionId)) return sessionId.toLowerCase() as Hex;
  const hex = sessionId.startsWith("0x") ? sessionId.slice(2) : sessionId;
  if (/^[0-9a-fA-F]{64}$/.test(hex)) return (`0x${hex.toLowerCase()}`) as Hex;
  return keccak256(toBytes(sessionId));
}

function toBytes32(raw: string): Hex {
  const hex = raw.startsWith("0x") ? raw.slice(2) : raw;
  return (`0x${hex.padStart(64, "0").slice(-64)}`) as Hex;
}

function hubDomain(chainId: number, verifyingContract: Hex) {
  return {
    name: "MozettoPokerSettlement",
    version: "2",
    chainId,
    verifyingContract,
  } as const;
}

function chainClients(pk: Hex) {
  const chainId = Number(process.env.CHAIN_ID || 84532);
  const chain = chainId === 31337 ? foundry : baseSepolia;
  const rpc =
    chainId === 31337
      ? process.env.ANVIL_RPC_URL || "http://127.0.0.1:8545"
      : process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
  const account = privateKeyToAccount(pk);
  const wallet = createWalletClient({ account, chain, transport: http(rpc) });
  const publicClient = createPublicClient({ chain, transport: http(rpc) });
  return { chainId, chain, rpc, account, wallet, publicClient };
}

async function tickPending() {
  const pending = await query(`select count(*)::int as n from settlements where status = 'pending'`).catch(
    () => ({ rows: [{ n: 0 }] }),
  );
  console.log("[settlement-worker] pending settlements", pending.rows[0]?.n ?? 0);
}

async function publishCheckpoints() {
  const registry = process.env.CHECKPOINT_REGISTRY_ADDRESS as Hex | undefined;
  const pk = (process.env.SETTLEMENT_PRIVATE_KEY || process.env.GAME_ATTESTOR_PRIVATE_KEY) as Hex | undefined;
  if (!registry || !pk) return;

  const rows = await query<{ table_id: string; max_seq: string; hand_id: string }>(
    `select table_id, max(sequence)::text as max_seq, max(hand_id) as hand_id
     from hand_events
     where created_at > now() - interval '5 minutes'
     group by table_id
     limit 10`,
  ).catch(() => ({ rows: [] as { table_id: string; max_seq: string; hand_id: string }[] }));

  if (!rows.rows.length) return;

  const { wallet, publicClient } = chainClients(pk);

  for (const row of rows.rows) {
    const tableId = keccakLike(row.table_id);
    const handsRoot = keccakLike(`${row.table_id}:${row.hand_id}:${row.max_seq}`);
    const balancesRoot = keccakLike(`balances:${row.table_id}:${row.max_seq}`);
    const attestationHash = keccakLike(`attestor:settlement-worker:${Date.now()}`);
    try {
      const hash = await wallet.writeContract({
        address: registry,
        abi: CHECKPOINT_ABI,
        functionName: "anchor",
        args: [
          {
            tableId,
            epoch: BigInt(1),
            lastEventSequence: BigInt(row.max_seq || 0),
            handsRoot,
            balancesRoot,
            timestamp: BigInt(Math.floor(Date.now() / 1000)),
            attestationHash,
          },
        ],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      console.log("[settlement-worker] checkpoint anchored", row.table_id, hash);
    } catch (e) {
      console.warn("[settlement-worker] checkpoint skip", row.table_id, e instanceof Error ? e.message : e);
    }
  }
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

async function buildProposal(session: SessionRow) {
  // Prefer latest table_session per player (active or completed). Never join on
  // osp.session_id = ts.id — custody session ids are bytes32, not table_session UUIDs.
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
  const eventRoot = canonical.rows[0]?.event_hash
    ? toBytes32(canonical.rows[0].event_hash)
    : keccakLike(`events:${session.session_id}:${finalSequence}`);

  const handRootRow = await query<{ hand_root: string }>(
    `select hand_root from hand_roots where session_id = $1 order by created_at desc limit 1`,
    [session.session_id],
  ).catch(() => ({ rows: [] as { hand_root: string }[] }));
  const handRoot = handRootRow.rows[0]?.hand_root
    ? toBytes32(handRootRow.rows[0].hand_root)
    : keccakLike(`hands:${session.session_id}`);

  const balanceRoot = keccakLike(`balances:${session.session_id}:${finalSequence}`);
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
  // Rake is the chips removed from the table as a whole, not the sum of
  // individual losses (which incorrectly counts chips won by another player).
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

async function collectAttestations(proposal: NonNullable<Awaited<ReturnType<typeof buildProposal>>>) {
  const hub = process.env.SETTLEMENT_HUB_ADDRESS as Hex | undefined;
  const gamePk = (process.env.GAME_ATTESTOR_PRIVATE_KEY || process.env.SETTLEMENT_PRIVATE_KEY) as Hex | undefined;
  const replayUrl = process.env.REPLAY_VERIFIER_URL ?? "http://localhost:4004";
  const signatures: Hex[] = [];
  const roles: ("game" | "replay" | "dealer")[] = [];

  if (gamePk && hub) {
    const { account, wallet, chainId } = chainClients(gamePk);
    const sig = await wallet.signTypedData({
      domain: hubDomain(chainId, hub),
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

async function submitHubSettlement(
  proposal: NonNullable<Awaited<ReturnType<typeof buildProposal>>>,
  signatures: Hex[],
) {
  const hub = process.env.SETTLEMENT_HUB_ADDRESS as Hex | undefined;
  const pk = (process.env.SETTLEMENT_PRIVATE_KEY || process.env.GAME_ATTESTOR_PRIVATE_KEY) as Hex | undefined;
  if (!hub || !pk || signatures.length < 2) {
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
    console.log("[settlement-worker] hub settle submitted", proposal.sessionId, hash);

    // The vault accrues rake for accounting; sweep it immediately to the
    // configured fee treasury after each successful settlement.
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
        console.log("[settlement-worker] protocol fees swept", fees.toString(), feeHash);
      }
    }

    // Post-settlement Glicko for on-chain HU sessions (deferred from game-server).
    await maybeRateOnchainSession(proposal.sessionId, proposal.balances).catch((e) =>
      console.warn("[settlement-worker] rated match skip", e),
    );
  } catch (e) {
    console.warn("[settlement-worker] hub settle failed", proposal.sessionId, e instanceof Error ? e.message : e);
    // Do not leave an invalid proposal in `proposed` forever. A fresh proposal
    // gets fresh attestations on the next pass.
    await query(`update settlement_proposals set status = 'rejected' where id = $1`, [
      proposal.proposalId,
    ]).catch(() => null);
  }
}

async function maybeRateOnchainSession(sessionId: string, _balances: Record<string, number>) {
  const meta = await query<{ table_id: string; variant_id: string; max_seats: number }>(
    `select os.table_id, t.variant_id::text as variant_id, t.max_seats::int as max_seats
     from onchain_sessions os
     join tables t on t.id = os.table_id
     where os.session_id = $1 limit 1`,
    [sessionId],
  );
  const tableId = meta.rows[0]?.table_id ?? null;
  const variantId = meta.rows[0]?.variant_id ?? "";
  const maxSeats = Number(meta.rows[0]?.max_seats ?? 0);

  const rows = await query<{ owner_id: string; agent_id: string; buy_in: string; stack: string }>(
    `select distinct on (owner_id)
            owner_id::text, coalesce(agent_id::text, '') as agent_id, buy_in::text, stack::text
     from table_sessions
     where table_id = $2
       and owner_id in (
         select profile_id from onchain_session_players where session_id = $1
       )
     order by owner_id, coalesce(ended_at, started_at) desc`,
    [sessionId, tableId],
  );
  // Only HU-style rating (exactly two owners). Multiway Classic stays unrated for now.
  if (rows.rows.length !== 2 || !tableId) return;
  const poolId =
    variantId === "nlhe_hu" || maxSeats === 2
      ? "hu_holdem_standard"
      : variantId === "nlhe_6max"
        ? "nlhe_6max_standard"
        : null;
  if (!poolId) return;
  const [a, b] = rows.rows;

  const handsRow = await query<{ n: string }>(
    `select count(*)::text as n from hands
     where table_id = $1 and (status = 'settled' or settled_at is not null)`,
    [tableId],
  );
  // Fall back to hand_number progress if status wasn't flipped for some hands.
  const maxHand = await query<{ m: string }>(
    `select coalesce(max(hand_number), 0)::text as m from hands where table_id = $1`,
    [tableId],
  );
  const hands = Math.max(
    Number(handsRow.rows[0]?.n ?? 0),
    Number(maxHand.rows[0]?.m ?? 0),
    1,
  );

  const profitA = Number(a.stack) - Number(a.buy_in);
  const profitB = Number(b.stack) - Number(b.buy_in);
  const scoreA: 0 | 0.5 | 1 = profitA > profitB ? 1 : profitA < profitB ? 0 : 0.5;
  await settleRatedMatch({
    poolId,
    ownerA: a.owner_id,
    ownerB: b.owner_id,
    agentA: a.agent_id || null,
    agentB: b.agent_id || null,
    scoreA,
    hands,
    tableId,
    stake: Number(a.buy_in),
    eventLogRoot: keccakLike(`onchain:${sessionId}`),
    reason: "onchain_settled",
  });
}

async function processOnchainSettlements() {
  const hub = process.env.SETTLEMENT_HUB_ADDRESS as Hex | undefined;
  const pk = (process.env.SETTLEMENT_PRIVATE_KEY || process.env.GAME_ATTESTOR_PRIVATE_KEY) as Hex | undefined;
  if (!hub || !pk) return;

  // Also pick opened sessions with no active seats (abandoned / both left) so
  // Instant buy-ins are not stuck locked forever waiting for a status flip.
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
    let proposal;
    if (existing.rows[0]) {
      console.log("[settlement-worker] proposal already exists", session.session_id);
      continue;
    }
    proposal = await buildProposal(session);
    if (!proposal) continue;
    await query(`update onchain_sessions set status = 'settling' where session_id = $1`, [session.session_id]).catch(
      () => null,
    );
    const { signatures } = await collectAttestations(proposal);
    await submitHubSettlement(proposal, signatures);
  }
}

console.log("[settlement-worker] running — quorum settle + checkpoints + mock VRF when configured");

async function loop() {
  await tickPending();
  await processOnchainSettlements().catch((e) => console.error(e));
  await publishCheckpoints().catch((e) => console.error(e));
  await mockVrfEpoch().catch((e) => console.error(e));
}

const SETTLEMENT_POLL_MS = Number(process.env.SETTLEMENT_POLL_MS || 15_000);
setInterval(() => {
  loop().catch(console.error);
}, SETTLEMENT_POLL_MS);

loop().catch(console.error);
