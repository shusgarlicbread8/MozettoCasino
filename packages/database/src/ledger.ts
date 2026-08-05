import { randomUUID } from "node:crypto";
import { query } from "./client.js";

export async function getAvailableBalance(userId: string): Promise<number> {
  const res = await query<{ balance: string }>(
    `select coalesce(sum(e.amount),0)::text as balance
     from ledger_accounts a
     left join ledger_entries e on e.account_id = a.id
     where a.owner_id = $1 and a.kind = 'user_available'`,
    [userId],
  );
  return Number(res.rows[0]?.balance ?? 0);
}

export async function getEscrowBalance(userId: string): Promise<number> {
  const res = await query<{ balance: string }>(
    `select coalesce(sum(e.amount),0)::text as balance
     from ledger_accounts a
     left join ledger_entries e on e.account_id = a.id
     where a.owner_id = $1 and a.kind = 'user_table_escrow'`,
    [userId],
  );
  return Number(res.rows[0]?.balance ?? 0);
}

async function accountId(userId: string | null, kind: string, label: string) {
  const res = await query<{ id: string }>(
    `select id from ledger_accounts where kind = $1 and label = $2 and ($3::uuid is null or owner_id = $3) limit 1`,
    [kind, label, userId],
  );
  if (!res.rows[0]) throw new Error(`Missing ledger account ${kind}/${label}`);
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

export async function lockBuyIn(userId: string, amount: number, sessionId: string) {
  const available = await accountId(userId, "user_available", "available");
  const escrow = await accountId(userId, "user_table_escrow", "escrow");
  const bal = await getAvailableBalance(userId);
  if (bal < amount) throw new Error("Insufficient available balance");
  return transfer({
    idempotencyKey: `buyin-${sessionId}`,
    description: `Bought in for $${amount}`,
    fromAccountId: available,
    toAccountId: escrow,
    amount,
    referenceType: "table_session",
    referenceId: sessionId,
  });
}

export async function releaseSession(userId: string, amount: number, sessionId: string) {
  const available = await accountId(userId, "user_available", "available");
  const escrow = await accountId(userId, "user_table_escrow", "escrow");
  if (amount <= 0) return null;
  return transfer({
    idempotencyKey: `cashout-${sessionId}`,
    description: `Cashed out $${amount} to wallet`,
    fromAccountId: escrow,
    toAccountId: available,
    amount,
    referenceType: "table_session",
    referenceId: sessionId,
  });
}

export async function postRake(amount: number, handId: string) {
  if (amount <= 0) return null;
  const clearing = await accountId(null, "system_clearing", "clearing");
  const rake = await accountId(null, "platform_rake", "rake");
  // Rake already removed from pot before awarding; book from clearing
  return transfer({
    idempotencyKey: `rake-${handId}`,
    description: `Rake ${amount}`,
    fromAccountId: clearing,
    toAccountId: rake,
    amount,
    referenceType: "hand",
    referenceId: handId,
  });
}

export async function fakeDeposit(userId: string, amount: number, key: string) {
  const available = await accountId(userId, "user_available", "available");
  const clearing = await accountId(null, "system_clearing", "clearing");
  return transfer({
    idempotencyKey: key,
    description: `Fake USDC deposit ${amount}`,
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
  changes: { userId: string; prevStack: number; nextStack: number }[],
) {
  const clearing = await accountId(null, "system_clearing", "clearing");
  for (const c of changes) {
    const delta = Math.round(c.nextStack - c.prevStack);
    if (delta === 0 || !c.userId || c.userId === "bot") continue;
    const escrow = await accountId(c.userId, "user_table_escrow", "escrow");
    if (delta < 0) {
      await transfer({
        idempotencyKey: `hand-loss-${handId}-${c.userId}`,
        description: `Lost $${-delta} this hand`,
        fromAccountId: escrow,
        toAccountId: clearing,
        amount: -delta,
        referenceType: "hand",
        referenceId: handId,
      });
    } else {
      await transfer({
        idempotencyKey: `hand-win-${handId}-${c.userId}`,
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

export async function listLedger(userId: string, limit = 50) {
  const res = await query(
    `select t.id, t.description, t.created_at, t.reference_type,
            (select sum(e.amount) from ledger_entries e
              join ledger_accounts a on a.id = e.account_id
              where e.transaction_id = t.id and a.owner_id = $1 and a.kind = 'user_available') as available_delta,
            (select sum(e.amount) from ledger_entries e
              join ledger_accounts a on a.id = e.account_id
              where e.transaction_id = t.id and a.owner_id = $1 and a.kind = 'user_table_escrow') as escrow_delta
     from ledger_transactions t
     where exists (
       select 1 from ledger_entries e
       join ledger_accounts a on a.id = e.account_id
       where e.transaction_id = t.id and a.owner_id = $1
     )
     order by t.created_at desc
     limit $2`,
    [userId, limit],
  );
  return res.rows;
}
