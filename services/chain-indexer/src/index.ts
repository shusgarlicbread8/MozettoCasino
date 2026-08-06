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
  type PublicClient,
} from "viem";
import { base, baseSepolia } from "viem/chains";
import { arenaVaultAbi, getChainConfig } from "@mozetto/blockchain";
import { query, creditOnchainDeposit, debitOnchainWithdrawal, creditOnchainBuyInFromWallet, debitOnchainSessionPayout } from "@mozetto/database";

const SNAPSHOT_MS = Number(process.env.INDEXER_NET_WORTH_MS ?? 60_000);
const erc20BalanceOf = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

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
const buyInLockedEvent = parseAbiItem(
  "event BuyInLocked(bytes32 indexed sessionId, address indexed player, uint256 fromAvailable, uint256 fromWallet)",
);
const sessionSettledEvent = parseAbiItem(
  "event SessionSettled(bytes32 indexed sessionId, uint256 rake, uint256 playerCount)",
);
const sessionPayoutEvent = parseAbiItem(
  "event SessionPayout(bytes32 indexed sessionId, address indexed player, uint256 amount)",
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
    `select coalesce(profile_id, user_id) as user_id
     from wallet_identities
     where lower(address) = lower($1)
     limit 1`,
    [wallet],
  );
  return res.rows[0]?.user_id ?? null;
}

async function upsertNetWorthSnapshot(
  chainId: number,
  profileId: string,
  wallet: Hex,
  client: PublicClient,
  usdc: Hex,
  vault: Hex | null,
) {
  const walletRaw = (await client.readContract({
    address: usdc,
    abi: erc20BalanceOf,
    functionName: "balanceOf",
    args: [wallet],
  })) as bigint;
  let lockedRaw = 0n;
  let legacyRaw = 0n;
  if (vault) {
    lockedRaw = (await client.readContract({
      address: vault,
      abi: arenaVaultAbi,
      functionName: "totalLocked",
      args: [wallet],
    })) as bigint;
    legacyRaw = (await client.readContract({
      address: vault,
      abi: arenaVaultAbi,
      functionName: "available",
      args: [wallet],
    })) as bigint;
  }
  const walletUsdc = Number(formatUnits(walletRaw, 6));
  const lockedUsdc = Number(formatUnits(lockedRaw, 6));
  const legacyUsdc = Number(formatUnits(legacyRaw, 6));
  const totalUsdc = walletUsdc + lockedUsdc + legacyUsdc;
  await query(
    `insert into wallet_net_worth_snapshots
       (profile_id, chain_id, bucket_at, wallet_usdc, locked_usdc, legacy_mozetto_usdc, total_usdc)
     values ($1, $2, date_trunc('minute', now()), $3, $4, $5, $6)
     on conflict (profile_id, chain_id, bucket_at) do update set
       wallet_usdc = excluded.wallet_usdc,
       locked_usdc = excluded.locked_usdc,
       legacy_mozetto_usdc = excluded.legacy_mozetto_usdc,
       total_usdc = excluded.total_usdc`,
    [profileId, chainId, walletUsdc, lockedUsdc, legacyUsdc, totalUsdc],
  );
}

async function snapshotWallet(
  chainId: number,
  wallet: string,
  client: PublicClient,
  usdc: Hex,
  vault: Hex | null,
) {
  const profileId = await resolveProfileId(wallet);
  if (!profileId) return;
  try {
    await upsertNetWorthSnapshot(chainId, profileId, wallet as Hex, client, usdc, vault);
  } catch (err) {
    console.warn("[indexer] net-worth snapshot failed", wallet, err);
  }
}

async function snapshotAllLinkedWallets(
  chainId: number,
  client: PublicClient,
  usdc: Hex,
  vault: Hex | null,
) {
  const res = await query<{ address: string }>(
    `select distinct lower(address) as address from wallet_identities where address is not null`,
  );
  for (const row of res.rows) {
    await snapshotWallet(chainId, row.address, client, usdc, vault);
  }
}

async function ensureCursor(
  chainId: number,
  vault: Hex,
  deploymentBlock: bigint,
  chainHead: bigint,
): Promise<bigint> {
  const existing = await query<{
    last_block: string;
    vault_address: string | null;
    deployment_block: string;
  }>(
    `select last_block::text, vault_address, coalesce(deployment_block, 0)::text as deployment_block
     from chain_cursors where chain_id = $1`,
    [chainId],
  );

  const row = existing.rows[0];
  const last = BigInt(row?.last_block ?? "0");
  const staleVault = row?.vault_address && row.vault_address.toLowerCase() !== vault.toLowerCase();
  const staleDeploy =
    row?.deployment_block && BigInt(row.deployment_block) !== deploymentBlock;
  const cursorPastHead = last > chainHead;

  if (!row || staleVault || staleDeploy || cursorPastHead) {
    if (row && (staleVault || staleDeploy || cursorPastHead)) {
      await query(
        `insert into chain_reorgs (chain_id, from_block, detail)
         values ($1, $2, $3::jsonb)`,
        [
          chainId,
          last.toString(),
          JSON.stringify({
            reason: staleVault
              ? "vault_redeployed"
              : staleDeploy
                ? "deployment_block_changed"
                : "cursor_past_head",
            previousVault: row.vault_address,
            nextVault: vault,
            previousCursor: last.toString(),
            chainHead: chainHead.toString(),
            deploymentBlock: deploymentBlock.toString(),
          }),
        ],
      );
      console.warn(
        `[indexer] resetting cursor chain=${chainId} from ${last} → ${deploymentBlock} (${staleVault ? "vault change" : cursorPastHead ? "past head" : "deploy change"})`,
      );
    }
    await query(
      `insert into chain_cursors (chain_id, last_block, last_log_index, vault_address, deployment_block, updated_at)
       values ($1, $2, 0, $3, $4, now())
       on conflict (chain_id) do update
         set last_block = excluded.last_block,
             last_log_index = 0,
             vault_address = excluded.vault_address,
             deployment_block = excluded.deployment_block,
             updated_at = now()`,
      [chainId, deploymentBlock.toString(), vault.toLowerCase(), deploymentBlock.toString()],
    );
    return deploymentBlock;
  }

  await query(
    `update chain_cursors
     set vault_address = $2, deployment_block = $3, updated_at = now()
     where chain_id = $1`,
    [chainId, vault.toLowerCase(), deploymentBlock.toString()],
  );
  return last > 0n ? last : deploymentBlock;
}

async function setCursor(chainId: number, block: bigint, logIndex: number) {
  await query(
    `update chain_cursors
     set last_block = $2, last_log_index = $3, updated_at = now()
     where chain_id = $1`,
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
       set removed = excluded.removed, args = excluded.args, block_hash = excluded.block_hash`,
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

async function rewindRemovedDeposit(chainId: number, txHash: string, logIndex: number) {
  const row = await query<{
    mirrored: boolean;
    profile_id: string | null;
    amount_usdc: string;
  }>(
    `select mirrored, profile_id, amount_usdc::text
     from vault_deposits
     where chain_id = $1 and tx_hash = $2 and log_index = $3`,
    [chainId, txHash, logIndex],
  );
  const d = row.rows[0];
  if (!d?.mirrored || !d.profile_id) return;
  await debitOnchainWithdrawal(d.profile_id, Number(d.amount_usdc), txHash, { reason: "reorg" });
  await query(
    `update vault_deposits set mirrored = false
     where chain_id = $1 and tx_hash = $2 and log_index = $3`,
    [chainId, txHash, logIndex],
  );
  console.warn(`[indexer] rewound deposit mirror ${txHash}#${logIndex}`);
}

async function handleDeposited(
  chainId: number,
  log: Log & { args: { user?: Hex; amount?: bigint } },
) {
  const user = log.args.user;
  const amount = log.args.amount;
  if (!user || amount === undefined || !log.transactionHash) return;

  if (log.removed) {
    await rewindRemovedDeposit(chainId, log.transactionHash, log.logIndex ?? 0);
    return;
  }

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
  if (!user || amount === undefined || !log.transactionHash) return;
  if (log.removed) return;

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

  const already = await query<{ mirrored: boolean }>(
    `select mirrored from vault_withdrawals
     where chain_id = $1 and tx_hash = $2 and log_index = $3`,
    [chainId, log.transactionHash, log.logIndex ?? 0],
  );
  if (already.rows[0]?.mirrored) return;

  if (profileId) {
    await debitOnchainWithdrawal(profileId, amountUsdc, log.transactionHash);
    await query(
      `update vault_withdrawals set mirrored = true, profile_id = $4
       where chain_id = $1 and tx_hash = $2 and log_index = $3`,
      [chainId, log.transactionHash, log.logIndex ?? 0, profileId],
    );
    console.log(`[indexer] mirrored withdraw ${amountUsdc} USDC ← ${profileId}`);
  }
}

async function backfillUnmirrored() {
  const deposits = await query<{
    chain_id: number;
    tx_hash: string;
    log_index: number;
    wallet_address: string;
    amount_usdc: string;
  }>(
    `select chain_id, tx_hash, log_index, wallet_address, amount_usdc::text
     from vault_deposits
     where mirrored = false
     order by created_at asc
     limit 50`,
  );
  for (const d of deposits.rows) {
    const profileId = await resolveProfileId(d.wallet_address);
    if (!profileId) continue;
    await creditOnchainDeposit(profileId, Number(d.amount_usdc), d.tx_hash);
    await query(
      `update vault_deposits set mirrored = true, profile_id = $4
       where chain_id = $1 and tx_hash = $2 and log_index = $3`,
      [d.chain_id, d.tx_hash, d.log_index, profileId],
    );
    console.log(`[indexer] backfilled deposit ${d.amount_usdc} → ${profileId}`);
  }

  const withdrawals = await query<{
    chain_id: number;
    tx_hash: string;
    log_index: number;
    wallet_address: string;
    amount_usdc: string;
  }>(
    `select chain_id, tx_hash, log_index, wallet_address, amount_usdc::text
     from vault_withdrawals
     where mirrored = false
     order by created_at asc
     limit 50`,
  );
  for (const w of withdrawals.rows) {
    const profileId = await resolveProfileId(w.wallet_address);
    if (!profileId) continue;
    await debitOnchainWithdrawal(profileId, Number(w.amount_usdc), w.tx_hash);
    await query(
      `update vault_withdrawals set mirrored = true, profile_id = $4
       where chain_id = $1 and tx_hash = $2 and log_index = $3`,
      [w.chain_id, w.tx_hash, w.log_index, profileId],
    );
    console.log(`[indexer] backfilled withdraw ${w.amount_usdc} ← ${profileId}`);
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

/** Instant Mode: credit wallet portion of buy-in so join lockBuyIn can succeed. */
async function handleBuyInLocked(
  chainId: number,
  log: Log & {
    args: {
      sessionId?: Hex;
      player?: Hex;
      fromAvailable?: bigint;
      fromWallet?: bigint;
    };
  },
) {
  const player = log.args.player;
  const fromWallet = log.args.fromWallet ?? 0n;
  if (!player || !log.transactionHash || log.removed) return;
  if (fromWallet === 0n) return;

  const amountUsdc = Number(formatUnits(fromWallet, 6));
  const profileId = await resolveProfileId(player);
  if (!profileId) {
    console.warn(`[indexer] BuyInLocked from unknown wallet ${player}`);
    return;
  }
  try {
    await creditOnchainBuyInFromWallet(
      profileId,
      amountUsdc,
      log.transactionHash,
      log.logIndex ?? 0,
    );
    console.log(
      `[indexer] Instant buy-in mirror ${amountUsdc} USDC from wallet → ${profileId}`,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/duplicate|unique|idempotency/i.test(msg)) return;
    throw e;
  }
}

/** Instant Mode: payout returned to ERC-20 wallet — clear durable playable mirror. */
async function handleSessionPayout(
  _chainId: number,
  log: Log & { args: { sessionId?: Hex; player?: Hex; amount?: bigint } },
) {
  const player = log.args.player;
  const amount = log.args.amount;
  if (!player || amount === undefined || !log.transactionHash || log.removed) return;

  const amountUsdc = Number(formatUnits(amount, 6));
  const profileId = await resolveProfileId(player);
  if (!profileId) {
    console.warn(`[indexer] SessionPayout to unknown wallet ${player}`);
    return;
  }
  try {
    await debitOnchainSessionPayout(
      profileId,
      amountUsdc,
      log.transactionHash,
      log.logIndex ?? 0,
    );
    console.log(
      `[indexer] Session payout debit ${amountUsdc} USDC ← ${profileId}`,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/duplicate|unique|idempotency/i.test(msg)) return;
    throw e;
  }
}

async function reconcile(chainId: number, vault: Hex, client: ReturnType<typeof createPublicClient>) {
  const run = await query<{ id: string }>(
    `insert into reconciliation_runs (chain_id, started_at) values ($1, now()) returning id::text`,
    [chainId],
  );
  const runId = run.rows[0]?.id;
  const env = getChainConfig().env;
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
    const ok = Math.abs(diff) < 1;
    await query(
      `insert into vault_balance_snapshots
         (chain_id, token_balance_raw, mirror_available_sum, difference_usdc, ok)
       values ($1,$2,$3,$4,$5)`,
      [chainId, (tokenBal as bigint).toString(), mirrorSum, diff, ok],
    );
    if (!ok && env === "base") {
      await query(
        `update feature_flags set enabled = false, updated_at = now(), meta = meta || '{"reason":"reconciliation_failed"}'::jsonb
         where key = 'onchain_matchmaking'`,
      );
      console.error(`[indexer] RECONCILIATION FAILED chain=${chainId} token=${tokenUsdc} mirror=${mirrorSum}`);
    } else if (!ok) {
      console.warn(`[indexer] reconcile skew (non-fatal) chain=${chainId} token=${tokenUsdc} mirror=${mirrorSum}`);
    }
    await query(
      `update reconciliation_runs set finished_at = now(), ok = $2, detail = $3::jsonb where id = $1`,
      [runId, ok, JSON.stringify({ tokenUsdc, mirrorSum, diff })],
    );
  } catch (err) {
    try {
      await query(
        `update reconciliation_runs set finished_at = now(), ok = false, detail = $2::jsonb where id = $1`,
        [runId, JSON.stringify({ error: String(err) })],
      );
    } catch {
      /* ignore */
    }
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
  let from = await ensureCursor(cfg.chainId, vault, cfg.deploymentBlock, latest);
  if (from > safeHead) {
    // Cursor is caught up — still try backfill for deposits recorded before SIWE.
    await backfillUnmirrored();
    return;
  }
  const to = from + 2_000n > safeHead ? safeHead : from + 2_000n;
  const fromBlock = from === 0n ? from : from + 1n;

  // Fetch event types separately — Anvil/some RPCs drop multi-event topic ORs.
  const [deposited, withdrawn, opened, buyInLocked, settled, payouts] = await Promise.all([
    client.getLogs({ address: vault, event: depositedEvent, fromBlock, toBlock: to }),
    client.getLogs({ address: vault, event: withdrawnEvent, fromBlock, toBlock: to }),
    client.getLogs({ address: vault, event: sessionOpenedEvent, fromBlock, toBlock: to }),
    client.getLogs({ address: vault, event: buyInLockedEvent, fromBlock, toBlock: to }),
    client.getLogs({ address: vault, event: sessionSettledEvent, fromBlock, toBlock: to }),
    client.getLogs({ address: vault, event: sessionPayoutEvent, fromBlock, toBlock: to }),
  ]);

  const logs = [...deposited, ...withdrawn, ...opened, ...buyInLocked, ...settled, ...payouts].sort(
    (a, b) => {
      const bn = Number((a.blockNumber ?? 0n) - (b.blockNumber ?? 0n));
      if (bn !== 0) return bn;
      return (a.logIndex ?? 0) - (b.logIndex ?? 0);
    },
  );

  const snapWallets = new Set<string>();
  for (const log of logs) {
    const name = (log as { eventName?: string }).eventName;
    const args = (log as { args?: Record<string, unknown> }).args ?? {};
    await persistEvent(cfg.chainId, log, name ?? "Unknown", args);
    if (name === "Deposited") {
      await handleDeposited(cfg.chainId, log as never);
      if (args.user) snapWallets.add(String(args.user).toLowerCase());
    } else if (name === "Withdrawn") {
      await handleWithdrawn(cfg.chainId, log as never);
      if (args.user) snapWallets.add(String(args.user).toLowerCase());
    } else if (name === "BuyInLocked") {
      await handleBuyInLocked(cfg.chainId, log as never);
      if (args.player) snapWallets.add(String(args.player).toLowerCase());
    } else if (name === "SessionOpened") {
      await handleSessionOpened(cfg.chainId, log as never);
    } else if (name === "SessionPayout") {
      await handleSessionPayout(cfg.chainId, log as never);
      if (args.player) snapWallets.add(String(args.player).toLowerCase());
    } else if (name === "SessionSettled") {
      await handleSessionSettled(cfg.chainId, log as never);
    }
  }

  for (const w of snapWallets) {
    await snapshotWallet(cfg.chainId, w, client, cfg.usdc, vault);
  }

  await setCursor(cfg.chainId, to, 0);
  await backfillUnmirrored();
  pollCount.n += 1;
  if (pollCount.n % RECONCILE_EVERY === 0) {
    await reconcile(cfg.chainId, vault, client);
  }
  if (logs.length) {
    console.log(`[indexer] processed ${logs.length} logs blocks ${fromBlock}-${to}`);
  }
}

console.log("[indexer] starting", getChainConfig().env, {
  vault: getChainConfig().contracts.arenaVault,
  usdc: getChainConfig().usdc,
  symbol: getChainConfig().symbol,
});
const counter = { n: 0 };
let ticking = false;
async function safeTick() {
  if (ticking) return;
  ticking = true;
  try {
    await tick(counter);
  } catch (err) {
    console.error("[indexer] tick failed", err);
  } finally {
    ticking = false;
  }
}
setInterval(() => {
  void safeTick();
}, POLL_MS);
void safeTick();

let snapshotting = false;
async function safeSnapshotAll() {
  if (snapshotting) return;
  snapshotting = true;
  try {
    const cfg = getChainConfig();
    const vault = cfg.contracts.arenaVault;
    if (!vault) return;
    const client = createPublicClient({
      chain: viemChain(cfg.chainId),
      transport: http(
        process.env[cfg.rpcUrlEnv] ||
          (cfg.chainId === 31337 ? "http://127.0.0.1:8545" : undefined),
      ),
    });
    await snapshotAllLinkedWallets(cfg.chainId, client as PublicClient, cfg.usdc, vault);
  } catch (err) {
    console.error("[indexer] net-worth sweep failed", err);
  } finally {
    snapshotting = false;
  }
}
setInterval(() => {
  void safeSnapshotAll();
}, SNAPSHOT_MS);
void safeSnapshotAll();
