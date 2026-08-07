/**
 * WP-112 — emit session_checkpoints from live session tips for the
 * proof-batch publisher SqlCheckpointSource.
 *
 * Also (optionally) anchors CheckpointRegistryV1 when CHECKPOINT_REGISTRY_ADDRESS
 * is set — uses the current contract shape (sessionId/sequence/eventRoot/…).
 */
import { encodeAbiParameters, keccak256, type Hex } from "viem";
import { query } from "@mozetto/database";
import { chainClients, sessionIdToBytes32, toBytes32 } from "./chain.js";

const CHECKPOINT_REGISTRY_ABI = [
  {
    type: "function",
    name: "anchor",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "cp",
        type: "tuple",
        components: [
          { name: "sessionId", type: "bytes32" },
          { name: "sequence", type: "uint64" },
          { name: "eventRoot", type: "bytes32" },
          { name: "balanceRoot", type: "bytes32" },
          { name: "timestamp", type: "uint64" },
          { name: "attestationHash", type: "bytes32" },
        ],
      },
    ],
    outputs: [],
  },
] as const;

/** Season-1 TableCheckpointRoot = keccak256(abi.encode(eventRoot, balanceRoot)). */
export function buildTableCheckpointRoot(eventRoot: Hex, balanceRoot: Hex): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }],
      [eventRoot.toLowerCase() as Hex, balanceRoot.toLowerCase() as Hex],
    ),
  );
}

type TipRow = {
  session_id: string;
  tip_sequence: string;
  event_hash: string;
  balance_root: string | null;
  hand_number: number | null;
  randomness_epoch: string | null;
};

/**
 * Insert unpublished session_checkpoints for sessions whose canonical tip
 * advanced past the last stored checkpoint sequence.
 */
export async function emitSessionCheckpoints(): Promise<number> {
  const tips = await query<TipRow>(
    `select os.session_id,
            tip.sequence::text as tip_sequence,
            tip.event_hash,
            coalesce(
              (
                select sp.balance_root
                from settlement_proposals sp
                where sp.session_id = os.session_id
                order by sp.created_at desc
                limit 1
              ),
              os.last_balance_root,
              tip.event_hash
            ) as balance_root,
            tip.hand_number,
            tip.randomness_epoch
     from onchain_sessions os
     join lateral (
       select sequence,
              event_hash,
              hand_number::int as hand_number,
              null::text as randomness_epoch
       from canonical_game_events
       where session_id = os.session_id
       order by sequence desc
       limit 1
     ) tip on true
     where os.status in ('opened', 'playing', 'settling', 'settled', 'closed')
       and not exists (
         select 1 from session_checkpoints sc
         where sc.session_id = os.session_id
           and sc.sequence = tip.sequence
       )
     order by tip.sequence desc
     limit 40`,
  ).catch((e) => {
    console.warn(
      "[settlement-worker] emitSessionCheckpoints query failed",
      e instanceof Error ? e.message : e,
    );
    return { rows: [] as TipRow[] };
  });

  let inserted = 0;
  for (const tip of tips.rows) {
    const eventRoot = toBytes32(tip.event_hash);
    const balanceRoot = toBytes32(tip.balance_root || tip.event_hash);
    const checkpointRoot = buildTableCheckpointRoot(eventRoot, balanceRoot);
    try {
      const res = await query(
        `insert into session_checkpoints
           (session_id, sequence, hand_number, event_root, balance_root,
            randomness_epoch, checkpoint_root)
         values ($1,$2,$3,$4,$5,$6,$7)
         on conflict (session_id, sequence) do nothing`,
        [
          tip.session_id,
          tip.tip_sequence,
          tip.hand_number,
          eventRoot,
          balanceRoot,
          tip.randomness_epoch,
          checkpointRoot,
        ],
      );
      if ((res.rowCount ?? 0) > 0) {
        inserted += 1;
        console.log(
          "[settlement-worker] session_checkpoint emitted",
          tip.session_id.slice(0, 18),
          "seq",
          tip.tip_sequence,
        );
      }
    } catch (e) {
      console.warn(
        "[settlement-worker] session_checkpoint insert skip",
        tip.session_id,
        e instanceof Error ? e.message : e,
      );
    }
  }
  return inserted;
}

/**
 * Anchor recently emitted SQL checkpoints on CheckpointRegistryV1 (optional).
 * Updates tx_hash when the chain write succeeds.
 */
export async function anchorCheckpointsOnchain(): Promise<void> {
  const registry = process.env.CHECKPOINT_REGISTRY_ADDRESS as Hex | undefined;
  const pk = (process.env.SETTLEMENT_PRIVATE_KEY ||
    process.env.GAME_ATTESTOR_PRIVATE_KEY) as Hex | undefined;
  if (!registry || !pk) return;

  const pending = await query<{
    id: string;
    session_id: string;
    sequence: string;
    event_root: string;
    balance_root: string;
  }>(
    `select id, session_id, sequence::text as sequence, event_root, balance_root
     from session_checkpoints
     where tx_hash is null
     order by created_at asc
     limit 10`,
  ).catch(() => ({
    rows: [] as Array<{
      id: string;
      session_id: string;
      sequence: string;
      event_root: string;
      balance_root: string;
    }>,
  }));

  if (!pending.rows.length) return;

  const { wallet, publicClient } = chainClients(pk);
  for (const row of pending.rows) {
    try {
      const sessionId = sessionIdToBytes32(row.session_id);
      const eventRoot = toBytes32(row.event_root);
      const balanceRoot = toBytes32(row.balance_root);
      const attestationHash = keccak256(
        encodeAbiParameters(
          [{ type: "bytes32" }, { type: "uint64" }],
          [sessionId, BigInt(row.sequence)],
        ),
      );
      const hash = await wallet.writeContract({
        address: registry,
        abi: CHECKPOINT_REGISTRY_ABI,
        functionName: "anchor",
        args: [
          {
            sessionId,
            sequence: BigInt(row.sequence),
            eventRoot,
            balanceRoot,
            timestamp: BigInt(Math.floor(Date.now() / 1000)),
            attestationHash,
          },
        ],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      await query(`update session_checkpoints set tx_hash = $2 where id = $1`, [
        row.id,
        hash,
      ]);
      console.log(
        "[settlement-worker] checkpoint anchored",
        row.session_id.slice(0, 18),
        hash,
      );
    } catch (e) {
      console.warn(
        "[settlement-worker] checkpoint anchor skip",
        row.session_id,
        e instanceof Error ? e.message : e,
      );
    }
  }
}
