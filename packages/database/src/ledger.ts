import { randomUUID } from "node:crypto";
import { query } from "./client.js";
import {
  type ArenaMode,
  parseArenaMode,
  parseProfileKind,
  economyForProfile,
} from "./arena-mode.js";

export type { ArenaMode, ProfileKind } from "./arena-mode.js";
export {
  isArenaMode,
  parseArenaMode,
  isProfileKind,
  parseProfileKind,
  economyForProfile,
} from "./arena-mode.js";

export async function getProfileKind(userId: string): Promise<import("./arena-mode.js").ProfileKind> {
  const res = await query<{ profile_kind: string }>(
    `select coalesce(profile_kind::text, 'demo') as profile_kind from profiles where id = $1`,
    [userId],
  );
  return parseProfileKind(res.rows[0]?.profile_kind, "demo");
}

/** Economy for this profile — derived from profile_kind (separate accounts, not a toggle). */
export async function getUserArenaMode(userId: string): Promise<ArenaMode> {
  const kind = await getProfileKind(userId);
  return economyForProfile(kind);
}

/** @deprecated Mode is fixed by profile_kind; kept for API compat during migration. */
export async function setUserArenaMode(userId: string, mode: ArenaMode): Promise<ArenaMode> {
  const kind = await getProfileKind(userId);
  const locked = economyForProfile(kind);
  if (mode !== locked) {
    throw new Error(
      kind === "demo"
        ? "Demo accounts cannot switch to on-chain. Sign in with a wallet at /onchain."
        : "On-chain accounts cannot switch to demo. Use a separate email account for Demo.",
    );
  }
  await ensureModeAccounts(userId, locked);
  return locked;
}

/** Ensure demo/onchain available+escrow accounts exist for a user. */
export async function ensureModeAccounts(userId: string, mode: ArenaMode) {
  await query(
    `insert into ledger_accounts (owner_id, kind, currency, label, arena_mode)
     values
       ($1, 'user_available', 'USDC', 'available', $2::arena_mode),
       ($1, 'user_table_escrow', 'USDC', 'escrow', $2::arena_mode)
     on conflict do nothing`,
    [userId, mode],
  );
  await query(
    `insert into ledger_accounts (owner_id, kind, currency, label, arena_mode)
     select null, kind, 'USDC', label, $1::arena_mode
     from (values
       ('system_clearing'::account_kind, 'clearing'),
       ('platform_rake'::account_kind, 'rake')
     ) v(kind, label)
     where not exists (
       select 1 from ledger_accounts a
       where a.owner_id is null and a.kind = v.kind and a.label = v.label and a.arena_mode = $1::arena_mode
     )`,
    [mode],
  );
}

export async function getAvailableBalance(userId: string, mode?: ArenaMode): Promise<number> {
  const arenaMode = mode ?? (await getUserArenaMode(userId));
  await ensureModeAccounts(userId, arenaMode);
  const res = await query<{ balance: string }>(
    `select coalesce(sum(e.amount),0)::text as balance
     from ledger_accounts a
     left join ledger_entries e on e.account_id = a.id
     where a.owner_id = $1 and a.kind = 'user_available' and a.arena_mode = $2::arena_mode`,
    [userId, arenaMode],
  );
  return Number(res.rows[0]?.balance ?? 0);
}

export async function getEscrowBalance(userId: string, mode?: ArenaMode): Promise<number> {
  const arenaMode = mode ?? (await getUserArenaMode(userId));
  await ensureModeAccounts(userId, arenaMode);
  const res = await query<{ balance: string }>(
    `select coalesce(sum(e.amount),0)::text as balance
     from ledger_accounts a
     left join ledger_entries e on e.account_id = a.id
     where a.owner_id = $1 and a.kind = 'user_table_escrow' and a.arena_mode = $2::arena_mode`,
    [userId, arenaMode],
  );
  return Number(res.rows[0]?.balance ?? 0);
}

async function accountId(userId: string | null, kind: string, label: string, mode: ArenaMode) {
  if (userId) await ensureModeAccounts(userId, mode);
  const res = await query<{ id: string }>(
    `select id from ledger_accounts
     where kind = $1 and label = $2 and arena_mode = $3::arena_mode
       and ($4::uuid is null or owner_id = $4)
     limit 1`,
    [kind, label, mode, userId],
  );
  if (!res.rows[0]) throw new Error(`Missing ledger account ${kind}/${label}/${mode}`);
  return res.rows[0].id;
}

/** Double-entry transfer. amounts are absolute; from is debited, to credited. */
export async function transfer(opts: {
  idempotencyKey: string;
  description: string;
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  referenceType?: string;
  referenceId?: string;
}) {
  if (opts.amount <= 0) throw new Error("Amount must be positive");
  const existing = await query(`select id from ledger_transactions where idempotency_key = $1`, [
    opts.idempotencyKey,
  ]);
  if (existing.rowCount) return existing.rows[0].id as string;

  const txId = randomUUID();
  await query("begin");
  try {
    await query(
      `insert into ledger_transactions (id, idempotency_key, description, status, reference_type, reference_id)
       values ($1,$2,$3,'posted',$4,$5)`,
      [txId, opts.idempotencyKey, opts.description, opts.referenceType ?? null, opts.referenceId ?? null],
    );
    await query(`insert into ledger_entries (transaction_id, account_id, amount) values ($1,$2,$3)`, [
      txId,
      opts.fromAccountId,
      -opts.amount,
    ]);
    await query(`insert into ledger_entries (transaction_id, account_id, amount) values ($1,$2,$3)`, [
      txId,
      opts.toAccountId,
      opts.amount,
    ]);
    await query("commit");
    return txId;
  } catch (e) {
    await query("rollback");
    throw e;
  }
}

export async function lockBuyIn(userId: string, amount: number, sessionId: string, mode?: ArenaMode) {
  const arenaMode = mode ?? (await getUserArenaMode(userId));
  const available = await accountId(userId, "user_available", "available", arenaMode);
  const escrow = await accountId(userId, "user_table_escrow", "escrow", arenaMode);
  const bal = await getAvailableBalance(userId, arenaMode);
  if (bal < amount) throw new Error("Insufficient available balance");
  return transfer({
    idempotencyKey: `buyin-${arenaMode}-${sessionId}`,
    description: `Bought in for $${amount} (${arenaMode})`,
    fromAccountId: available,
    toAccountId: escrow,
    amount,
    referenceType: "table_session",
    referenceId: sessionId,
  });
}

export async function releaseSession(userId: string, amount: number, sessionId: string, mode?: ArenaMode) {
  const arenaMode = mode ?? (await getUserArenaMode(userId));
  const escrow = await accountId(userId, "user_table_escrow", "escrow", arenaMode);
  if (amount <= 0) return null;

  // Instant / on-chain: settle transfers USDC to the wallet — do not leave idle Mozetto available.
  if (arenaMode === "onchain") {
    const clearing = await accountId(null, "system_clearing", "clearing", "onchain");
    return transfer({
      idempotencyKey: `cashout-${arenaMode}-${sessionId}`,
      description: `Cashed out $${amount} to wallet (onchain Instant)`,
      fromAccountId: escrow,
      toAccountId: clearing,
      amount,
      referenceType: "table_session",
      referenceId: sessionId,
    });
  }

  const available = await accountId(userId, "user_available", "available", arenaMode);
  return transfer({
    idempotencyKey: `cashout-${arenaMode}-${sessionId}`,
    description: `Cashed out $${amount} to wallet (${arenaMode})`,
    fromAccountId: escrow,
    toAccountId: available,
    amount,
    referenceType: "table_session",
    referenceId: sessionId,
  });
}

export async function postRake(amount: number, handId: string, mode: ArenaMode = "demo") {
  if (amount <= 0) return null;
  const clearing = await accountId(null, "system_clearing", "clearing", mode);
  const rake = await accountId(null, "platform_rake", "rake", mode);
  return transfer({
    idempotencyKey: `rake-${mode}-${handId}`,
    description: `Rake ${amount} (${mode})`,
    fromAccountId: clearing,
    toAccountId: rake,
    amount,
    referenceType: "hand",
    referenceId: handId,
  });
}

/** Demo-only paper funding. On-chain mode must deposit real USDC via ArenaVault. */
export async function fakeDeposit(userId: string, amount: number, key: string, mode: ArenaMode = "demo") {
  if (mode !== "demo") {
    throw new Error("On-chain mode requires a Base USDC vault deposit — paper funding is disabled.");
  }
  const available = await accountId(userId, "user_available", "available", "demo");
  const clearing = await accountId(null, "system_clearing", "clearing", "demo");
  return transfer({
    idempotencyKey: key,
    description: `Demo USDC deposit ${amount}`,
    fromAccountId: clearing,
    toAccountId: available,
    amount,
    referenceType: "deposit",
    referenceId: key,
  });
}

/**
 * Keep each player's table escrow equal to their current stack after a hand.
 * Decreases move chips into system_clearing (the pot pool); increases pull from it.
 */
export async function rebalanceEscrowToStacks(
  handId: string,
  changes: { userId: string; prevStack: number; nextStack: number; mode?: ArenaMode }[],
  mode?: ArenaMode,
) {
  for (const c of changes) {
    const arenaMode = c.mode ?? mode ?? (c.userId ? await getUserArenaMode(c.userId) : "demo");
    const clearing = await accountId(null, "system_clearing", "clearing", arenaMode);
    const delta = Math.round(c.nextStack - c.prevStack);
    if (delta === 0 || !c.userId || c.userId === "bot") continue;
    const escrow = await accountId(c.userId, "user_table_escrow", "escrow", arenaMode);
    if (delta < 0) {
      await transfer({
        idempotencyKey: `hand-loss-${arenaMode}-${handId}-${c.userId}`,
        description: `Lost $${-delta} this hand`,
        fromAccountId: escrow,
        toAccountId: clearing,
        amount: -delta,
        referenceType: "hand",
        referenceId: handId,
      });
    } else {
      await transfer({
        idempotencyKey: `hand-win-${arenaMode}-${handId}-${c.userId}`,
        description: `Won $${delta} this hand`,
        fromAccountId: clearing,
        toAccountId: escrow,
        amount: delta,
        referenceType: "hand",
        referenceId: handId,
      });
    }
  }
}

export async function listLedger(userId: string, limit = 50, mode?: ArenaMode) {
  const arenaMode = mode ?? (await getUserArenaMode(userId));
  const res = await query(
    `select t.id, t.description, t.created_at, t.reference_type,
            (select sum(e.amount) from ledger_entries e
              join ledger_accounts a on a.id = e.account_id
              where e.transaction_id = t.id and a.owner_id = $1 and a.kind = 'user_available'
                and a.arena_mode = $3::arena_mode) as available_delta,
            (select sum(e.amount) from ledger_entries e
              join ledger_accounts a on a.id = e.account_id
              where e.transaction_id = t.id and a.owner_id = $1 and a.kind = 'user_table_escrow'
                and a.arena_mode = $3::arena_mode) as escrow_delta
     from ledger_transactions t
     where exists (
       select 1 from ledger_entries e
       join ledger_accounts a on a.id = e.account_id
       where e.transaction_id = t.id and a.owner_id = $1 and a.arena_mode = $3::arena_mode
     )
     order by t.created_at desc
     limit $2`,
    [userId, limit, arenaMode],
  );
  return res.rows;
}

/** Credit on-chain mirrored available balance after a confirmed vault deposit (indexer only). */
export async function creditOnchainDeposit(userId: string, amount: number, txHash: string) {
  const hash = normalizeTxHash(txHash);
  await ensureModeAccounts(userId, "onchain");
  const available = await accountId(userId, "user_available", "available", "onchain");
  const clearing = await accountId(null, "system_clearing", "clearing", "onchain");
  return transfer({
    idempotencyKey: `onchain-deposit-${hash}`,
    description: `On-chain vault deposit ${amount}`,
    fromAccountId: clearing,
    toAccountId: available,
    amount,
    referenceType: "chain_deposit",
    referenceId: hash,
  });
}

/**
 * Instant Mode: mirror wallet→vault lock so table join can lockBuyIn against available.
 * Only credits the fromWallet portion (fromAvailable was already mirrored via deposit).
 */
export async function creditOnchainBuyInFromWallet(
  userId: string,
  amount: number,
  txHash: string,
  logIndex: number,
) {
  const hash = normalizeTxHash(txHash);
  if (amount <= 0) return null;
  await ensureModeAccounts(userId, "onchain");
  const available = await accountId(userId, "user_available", "available", "onchain");
  const clearing = await accountId(null, "system_clearing", "clearing", "onchain");
  return transfer({
    idempotencyKey: `onchain-buyin-wallet-${hash}-${logIndex}`,
    description: `Instant lock from wallet ${amount}`,
    fromAccountId: clearing,
    toAccountId: available,
    amount,
    referenceType: "chain_buyin_lock",
    referenceId: `${hash}:${logIndex}`,
  });
}

/**
 * Instant Mode: settle/emergency payout returns USDC to the wallet — clear the mirror.
 */
export async function debitOnchainSessionPayout(
  userId: string,
  amount: number,
  txHash: string,
  logIndex: number,
) {
  const hash = normalizeTxHash(txHash);
  if (amount <= 0) return null;
  await ensureModeAccounts(userId, "onchain");
  const available = await accountId(userId, "user_available", "available", "onchain");
  const clearing = await accountId(null, "system_clearing", "clearing", "onchain");
  const bal = await getAvailableBalance(userId, "onchain");
  const debit = Math.min(amount, bal);
  if (debit <= 0) return null;
  return transfer({
    idempotencyKey: `onchain-payout-${hash}-${logIndex}`,
    description: `Session payout to wallet ${debit}`,
    fromAccountId: available,
    toAccountId: clearing,
    amount: debit,
    referenceType: "chain_session_payout",
    referenceId: `${hash}:${logIndex}`,
  });
}

/** Debit on-chain mirrored available balance after a confirmed vault withdrawal (indexer only). */
export async function debitOnchainWithdrawal(
  userId: string,
  amount: number,
  txHash: string,
  opts?: { reason?: "withdraw" | "reorg" },
) {
  const hash = normalizeTxHash(txHash);
  const reason = opts?.reason ?? "withdraw";
  if (amount <= 0) return null;
  await ensureModeAccounts(userId, "onchain");
  const available = await accountId(userId, "user_available", "available", "onchain");
  const clearing = await accountId(null, "system_clearing", "clearing", "onchain");
  const bal = await getAvailableBalance(userId, "onchain");
  // Cap debit to available mirror so orphaned historical faucet skew cannot block withdraw mirrors.
  const debit = Math.min(amount, bal);
  if (debit <= 0) return null;
  return transfer({
    idempotencyKey: `onchain-${reason}-${hash}`,
    description:
      reason === "reorg"
        ? `Reorg rewind deposit ${debit}`
        : `On-chain vault withdraw ${debit}`,
    fromAccountId: available,
    toAccountId: clearing,
    amount: debit,
    referenceType: reason === "reorg" ? "chain_reorg" : "chain_withdraw",
    referenceId: hash,
  });
}

function normalizeTxHash(txHash: string): string {
  const m = txHash.match(/^(0x[a-fA-F0-9]{64})/);
  if (!m) {
    throw new Error("On-chain ledger mutations require a real transaction hash from the indexer");
  }
  return m[1].toLowerCase();
}
