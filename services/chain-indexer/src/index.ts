/**
 * Chain indexer — sole authority for vault deposit/withdraw mirror credits.
 * Polls ArenaVault logs; idempotent on (chainId, txHash, logIndex).
 */
import {
  createPublicClient,
  http,
  parseAbiItem,
  formatUnits,
  type Hex,
  type Log,
} from "viem";
import { base, baseSepolia } from "viem/chains";
import { getChainConfig, arenaVaultAbi } from "@mozetto/blockchain";
import { query, creditOnchainDeposit } from "@mozetto/database";

const CONFIRMATIONS = Number(process.env.INDEXER_CONFIRMATIONS ?? 3);
const POLL_MS = Number(process.env.INDEXER_POLL_MS ?? 8_000);
const RECONCILE_EVERY = Number(process.env.INDEXER_RECONCILE_EVERY ?? 30);

const depositedEvent = parseAbiItem(
  "event Deposited(address indexed user, uint256 amount)",
);
const withdrawnEvent = parseAbiItem(
  "event Withdrawn(address indexed user, address indexed to, uint256 amount)",
);
const sessionOpenedEvent = parseAbiItem(
  "event SessionOpened(bytes32 indexed sessionId, bytes32 indexed templateId, uint256 playerCount)",
);
const sessionSettledEvent = parseAbiItem(
  "event SessionSettled(bytes32 indexed sessionId, uint256 rake, uint256 playerCount)",
);

function viemChain(chainId: number) {
  if (chainId === 8453) return base;
  if (chainId === 84532) return baseSepolia;
  return {
    id: chainId,
    name: "anvil",
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [process.env.ANVIL_RPC_URL || "http://127.0.0.1:8545"] } },
  } as const;
}

async function resolveProfileId(wallet: string): Promise<string | null> {
  const res = await query<{ user_id: string }>(
    `select user_id from wallet_identities where lower(address) = lower($1) limit 1`,
    [wallet],
  );
  return res.rows[0]?.user_id ?? null;
}

async function getCursor(chainId: number, deploymentBlock: bigint): Promise<bigint> {
  const res = await query<{ last_block: string }>(
    `insert into chain_cursors (chain_id, last_block)
     values ($1, $2)
     on conflict (chain_id) do update set chain_id = excluded.chain_id
     returning last_block::text`,
    [chainId, deploymentBlock.toString()],
  );
  const n = BigInt(res.rows[0]?.last_block ?? "0");
  return n > 0n ? n : deploymentBlock;
}

async function setCursor(chainId: number, block: bigint, logIndex: number) {
  await query(
    `insert into chain_cursors (chain_id, last_block, last_log_index, updated_at)
     values ($1, $2, $3, now())
     on conflict (chain_id) do update
       set last_block = excluded.last_block,
           last_log_index = excluded.last_log_index,
           updated_at = now()`,
    [chainId, block.toString(), logIndex],
  );
}

async function persistEvent(
  chainId: number,
  log: Log,
  eventName: string,
  args: Record<string, unknown>,
) {
  await query(
    `insert into chain_events
       (chain_id, tx_hash, log_index, block_number, block_hash, address, event_name, args, removed)
     values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)
     on conflict (chain_id, tx_hash, log_index) do update
       set removed = excluded.removed, args = excluded.args`,
    [
      chainId,
      log.transactionHash,
      log.logIndex ?? 0,
      (log.blockNumber ?? 0n).toString(),
      log.blockHash,
      log.address,
      eventName,
      JSON.stringify(args, (_, v) => (typeof v === "bigint" ? v.toString() : v)),
      Boolean(log.removed),
    ],
  );
}

async function handleDeposited(
  chainId: number,
  log: Log & { args: { user?: Hex; amount?: bigint } },
) {
  const user = log.args.user;
  const amount = log.args.amount;
  if (!user || amount === undefined || !log.transactionHash) return;
  if (log.removed) return;

  const amountUsdc = Number(formatUnits(amount, 6));
  const profileId = await resolveProfileId(user);

  await query(
    `insert into vault_deposits
       (chain_id, tx_hash, log_index, block_number, wallet_address, amount_raw, amount_usdc, profile_id, mirrored)
     values ($1,$2,$3,$4,$5,$6,$7,$8,false)
     on conflict (chain_id, tx_hash, log_index) do nothing`,
    [
      chainId,
      log.transactionHash,
      log.logIndex ?? 0,
      (log.blockNumber ?? 0n).toString(),
      user.toLowerCase(),
      amount.toString(),
      amountUsdc,
      profileId,
    ],
  );

  if (!profileId) {
    console.warn(`[indexer] deposit from unknown wallet ${user} — mirror skipped until SIWE`);
    return;
  }

  const already = await query<{ mirrored: boolean }>(
    `select mirrored from vault_deposits
     where chain_id = $1 and tx_hash = $2 and log_index = $3`,
    [chainId, log.transactionHash, log.logIndex ?? 0],
  );
  if (already.rows[0]?.mirrored) return;

  await creditOnchainDeposit(profileId, amountUsdc, log.transactionHash);
  await query(
    `update vault_deposits set mirrored = true, profile_id = $4
     where chain_id = $1 and tx_hash = $2 and log_index = $3`,
    [chainId, log.transactionHash, log.logIndex ?? 0, profileId],
  );
  console.log(`[indexer] mirrored deposit ${amountUsdc} USDC → ${profileId}`);
}

async function handleWithdrawn(
  chainId: number,
  log: Log & { args: { user?: Hex; to?: Hex; amount?: bigint } },
) {
  const user = log.args.user;
  const amount = log.args.amount;
  if (!user || amount === undefined || !log.transactionHash || log.removed) return;
  const amountUsdc = Number(formatUnits(amount, 6));
  const profileId = await resolveProfileId(user);

  await query(
    `insert into vault_withdrawals
       (chain_id, tx_hash, log_index, block_number, wallet_address, to_address, amount_raw, amount_usdc, profile_id, mirrored)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,false)
     on conflict (chain_id, tx_hash, log_index) do nothing`,
    [
      chainId,
      log.transactionHash,
      log.logIndex ?? 0,
      (log.blockNumber ?? 0n).toString(),
      user.toLowerCase(),
      log.args.to?.toLowerCase() ?? null,
      amount.toString(),
      amountUsdc,
      profileId,
    ],
  );

  // Mirror debit: insert negative via ledger transfer pattern — creditOnchainDeposit is credit-only;
  // record row; wallet UI prefers vault.available for on-chain truth.
  if (profileId) {
    await query(
      `update vault_withdrawals set mirrored = true where chain_id = $1 and tx_hash = $2 and log_index = $3`,
      [chainId, log.transactionHash, log.logIndex ?? 0],
    );
  }
}

async function handleSessionOpened(
  chainId: number,
  log: Log & { args: { sessionId?: Hex; templateId?: Hex; playerCount?: bigint } },
) {
  const sessionId = log.args.sessionId;
  if (!sessionId || !log.transactionHash || log.removed) return;
  await query(
    `insert into onchain_sessions
       (session_id, chain_id, game_template_id, open_tx_hash, open_block, status, opened_at)
     values ($1,$2,$3,$4,$5,'opened', now())
     on conflict (session_id) do update
       set status = 'opened',
           open_tx_hash = excluded.open_tx_hash,
           open_block = excluded.open_block,
           opened_at = now()`,
    [
      sessionId,
      chainId,
      log.args.templateId ?? "",
      log.transactionHash,
      (log.blockNumber ?? 0n).toString(),
    ],
  );
  await query(
    `update matchmaking_batches set status = 'opened', opened_at = now(), open_tx_hash = $2
     where session_id = $1`,
    [sessionId, log.transactionHash],
  );
  await query(
    `update seat_tickets set status = 'opened' where session_id = $1`,
    [sessionId],
  );
  console.log(`[indexer] SessionOpened ${sessionId}`);
}

async function handleSessionSettled(
  chainId: number,
  log: Log & { args: { sessionId?: Hex } },
) {
  const sessionId = log.args.sessionId;
  if (!sessionId || !log.transactionHash || log.removed) return;
  await query(
    `update onchain_sessions
     set status = 'settled', settlement_tx_hash = $2, settled_at = now()
     where session_id = $1`,
    [sessionId, log.transactionHash],
  );
  await query(
    `update onchain_seat_locks set status = 'settled'
     where session_id = $1`,
    [sessionId],
  );
}

async function reconcile(chainId: number, vault: Hex, client: ReturnType<typeof createPublicClient>) {
  const run = await query<{ id: string }>(
    `insert into reconciliation_runs (chain_id, started_at) values ($1, now()) returning id::text`,
    [chainId],
  );
  const runId = run.rows[0]?.id;
  try {
    const tokenBal = await client.readContract({
      address: vault,
      abi: [
        {
          type: "function",
          name: "usdcBalance",
          stateMutability: "view",
          inputs: [],
          outputs: [{ type: "uint256" }],
        },
      ] as const,
      functionName: "usdcBalance",
    });
    const mirror = await query<{ s: string }>(
      `select coalesce(sum(e.amount),0)::text as s
       from ledger_accounts a
       left join ledger_entries e on e.account_id = a.id
       where a.arena_mode = 'onchain' and a.kind in ('user_available','user_table_escrow')`,
    );
    const mirrorSum = Number(mirror.rows[0]?.s ?? 0);
    const tokenUsdc = Number(formatUnits(tokenBal as bigint, 6));
    const diff = tokenUsdc - mirrorSum;
    const ok = Math.abs(diff) < 1; // $1 tolerance (fees accrued on-chain may lag mirror)
    await query(
      `insert into vault_balance_snapshots
         (chain_id, token_balance_raw, mirror_available_sum, difference_usdc, ok)
       values ($1,$2,$3,$4,$5)`,
      [chainId, (tokenBal as bigint).toString(), mirrorSum, diff, ok],
    );
    if (!ok) {
      await query(
        `update feature_flags set enabled = false, updated_at = now(), meta = meta || '{"reason":"reconciliation_failed"}'::jsonb
         where key = 'onchain_matchmaking'`,
      );
      console.error(`[indexer] RECONCILIATION FAILED chain=${chainId} token=${tokenUsdc} mirror=${mirrorSum}`);
    }
    await query(
      `update reconciliation_runs set finished_at = now(), ok = $2, detail = $3::jsonb where id = $1`,
      [runId, ok, JSON.stringify({ tokenUsdc, mirrorSum, diff })],
    );
  } catch (err) {
    await query(
      `update reconciliation_runs set finished_at = now(), ok = false, detail = $2::jsonb where id = $1`,
      [runId, JSON.stringify({ error: String(err) })],
    );
    console.error("[indexer] reconcile error", err);
  }
}

async function tick(pollCount: { n: number }) {
  const cfg = getChainConfig();
  const vault = cfg.contracts.arenaVault;
  if (!vault) {
    console.warn("[indexer] arenaVault not in manifest — idle");
    return;
  }
  const rpc =
    process.env[cfg.rpcUrlEnv] ||
    process.env.BASE_SEPOLIA_RPC_URL ||
    process.env.ANVIL_RPC_URL ||
    "http://127.0.0.1:8545";

  const client = createPublicClient({
    chain: viemChain(cfg.chainId),
    transport: http(rpc),
  });

  const latest = await client.getBlockNumber();
  const safeHead = latest > BigInt(CONFIRMATIONS) ? latest - BigInt(CONFIRMATIONS) : 0n;
  let from = await getCursor(cfg.chainId, cfg.deploymentBlock);
  if (from > safeHead) return;
  const to = from + 2_000n > safeHead ? safeHead : from + 2_000n;

  const logs = await client.getLogs({
    address: vault,
    events: [depositedEvent, withdrawnEvent, sessionOpenedEvent, sessionSettledEvent],
    fromBlock: from === 0n ? from : from + 1n,
    toBlock: to,
  });

  for (const log of logs) {
    const name = (log as { eventName?: string }).eventName;
    const args = (log as { args?: Record<string, unknown> }).args ?? {};
    await persistEvent(cfg.chainId, log, name ?? "Unknown", args);
    if (name === "Deposited") await handleDeposited(cfg.chainId, log as never);
    else if (name === "Withdrawn") await handleWithdrawn(cfg.chainId, log as never);
    else if (name === "SessionOpened") await handleSessionOpened(cfg.chainId, log as never);
    else if (name === "SessionSettled") await handleSessionSettled(cfg.chainId, log as never);
  }

  await setCursor(cfg.chainId, to, 0);
  pollCount.n += 1;
  if (pollCount.n % RECONCILE_EVERY === 0) {
    await reconcile(cfg.chainId, vault, client);
  }
  if (logs.length) {
    console.log(`[indexer] processed ${logs.length} logs blocks ${from}-${to}`);
  }
}

console.log("[indexer] starting", getChainConfig().env);
const counter = { n: 0 };
setInterval(() => {
  void tick(counter).catch((err) => console.error("[indexer] tick failed", err));
}, POLL_MS);
void tick(counter).catch(console.error);
