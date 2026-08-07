/**
 * Sole-writer money mirror handlers.
 * Only Deposited / Withdrawn / BuyInLocked / SessionPayout mutate ledger balances.
 */
import {
  query,
  creditOnchainDeposit,
  debitOnchainWithdrawal,
  creditOnchainBuyInFromWallet,
  debitOnchainSessionPayout,
  resolveProfileForChainAddress,
} from "@mozetto/database";
import { formatUnits, type Hex, type Log } from "viem";

async function resolveProfileId(wallet: string, chainId?: number): Promise<string | null> {
  if (chainId != null) {
    const viaAccount = await resolveProfileForChainAddress(wallet, chainId);
    if (viaAccount) return viaAccount;
  }
  const res = await query<{ user_id: string }>(
    `select coalesce(profile_id, user_id) as user_id
     from wallet_identities
     where lower(address) = lower($1)
     limit 1`,
    [wallet],
  );
  if (res.rows[0]?.user_id) return res.rows[0].user_id;
  const aa = await query<{ profile_id: string }>(
    `select profile_id from arena_accounts where lower(arena_account_address) = lower($1) limit 1`,
    [wallet],
  );
  return aa.rows[0]?.profile_id ?? null;
}

export async function rewindRemovedDeposit(chainId: number, txHash: string, logIndex: number) {
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

/** Rewind all mirrored deposits at/after fromBlock (reorg path). */
export async function rewindDepositsFromBlock(chainId: number, fromBlock: bigint): Promise<number> {
  const rows = await query<{
    tx_hash: string;
    log_index: number;
    profile_id: string;
    amount_usdc: string;
  }>(
    `select tx_hash, log_index, profile_id, amount_usdc::text
     from vault_deposits
     where chain_id = $1 and block_number >= $2 and mirrored = true and profile_id is not null`,
    [chainId, fromBlock.toString()],
  );
  let n = 0;
  for (const d of rows.rows) {
    await debitOnchainWithdrawal(d.profile_id, Number(d.amount_usdc), d.tx_hash, {
      reason: "reorg",
    });
    await query(
      `update vault_deposits set mirrored = false
       where chain_id = $1 and tx_hash = $2 and log_index = $3`,
      [chainId, d.tx_hash, d.log_index],
    );
    n += 1;
  }
  if (n) console.warn(`[indexer] rewound ${n} deposit mirrors from block ${fromBlock}`);
  return n;
}

export async function handleDeposited(
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

export async function handleWithdrawn(
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

export async function handleBuyInLocked(
  chainId: number,
  log: Log & {
    args: {
      sessionId?: Hex;
      player?: Hex;
      fromAvailable?: bigint;
      fromWallet?: bigint;
      amount?: bigint;
    };
  },
) {
  const player = log.args.player;
  const fromWallet = log.args.fromWallet ?? 0n;
  const v2Amount = log.args.amount ?? 0n;
  const pull = v2Amount > 0n ? v2Amount : fromWallet;
  if (!player || !log.transactionHash || log.removed) return;
  if (pull === 0n) return;

  const amountUsdc = Number(formatUnits(pull, 6));
  const profileId = await resolveProfileId(player, chainId);
  if (!profileId) {
    console.warn(`[indexer] BuyInLocked from unknown account ${player}`);
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
      `[indexer] Buy-in mirror ${amountUsdc} USDC from ArenaAccount → ${profileId}`,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/duplicate|unique|idempotency/i.test(msg)) return;
    throw e;
  }
}

export async function handleSessionPayout(
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
    console.log(`[indexer] Session payout debit ${amountUsdc} USDC ← ${profileId}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/duplicate|unique|idempotency/i.test(msg)) return;
    throw e;
  }
}

export async function backfillUnmirrored() {
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

export { resolveProfileId };
