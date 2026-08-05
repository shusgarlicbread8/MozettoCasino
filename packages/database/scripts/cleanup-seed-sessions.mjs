/**
 * Cash out any active sessions on retired seed tables, then mark them completed.
 * Run after 006_real_tables_only.sql.
 */
import pg from "pg";

const SEED_IDS = [
  "tbl_monaco_12",
  "tbl_emerald_4",
  "tbl_harbour_9",
  "tbl_viper_high",
  "tbl_seoul_2",
  "tbl_meridian_private",
];

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL required");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();

try {
  const sessions = await client.query(
    `select id, owner_id, stack from table_sessions
     where status = 'active' and table_id = any($1::text[])`,
    [SEED_IDS],
  );

  for (const s of sessions.rows) {
    const amount = Number(s.stack) || 0;
    if (amount > 0) {
      const avail = await client.query(
        `select id from ledger_accounts where owner_id = $1 and kind = 'user_available' limit 1`,
        [s.owner_id],
      );
      const escrow = await client.query(
        `select id from ledger_accounts where owner_id = $1 and kind = 'user_table_escrow' limit 1`,
        [s.owner_id],
      );
      if (avail.rows[0] && escrow.rows[0]) {
        const txId = crypto.randomUUID();
        await client.query("begin");
        try {
          await client.query(
            `insert into ledger_transactions (id, idempotency_key, description, status, reference_type, reference_id)
             values ($1, $2, $3, 'posted', 'table_session', $4)
             on conflict (idempotency_key) do nothing`,
            [txId, `cashout-seed-${s.id}`, `Seed table cash-out ${amount}`, s.id],
          );
          const exists = await client.query(
            `select 1 from ledger_entries e join ledger_transactions t on t.id = e.transaction_id
             where t.idempotency_key = $1 limit 1`,
            [`cashout-seed-${s.id}`],
          );
          if (!exists.rows[0]) {
            await client.query(
              `insert into ledger_entries (transaction_id, account_id, amount) values ($1,$2,$3), ($1,$4,$5)`,
              [txId, escrow.rows[0].id, -amount, avail.rows[0].id, amount],
            );
          }
          await client.query("commit");
        } catch (e) {
          await client.query("rollback");
          throw e;
        }
      }
    }
    await client.query(
      `update table_sessions set status = 'completed', stack = $1, ended_at = coalesce(ended_at, now()) where id = $2`,
      [amount, s.id],
    );
    console.log("cashed out session", s.id, amount);
  }

  // Also empty any remaining occupied seats on seed tables
  await client.query(
    `update table_seats set status = 'empty', agent_id = null, owner_id = null, stack = 0, updated_at = now()
     where table_id = any($1::text[])`,
    [SEED_IDS],
  );
  await client.query(`update tables set is_active = false where id = any($1::text[])`, [SEED_IDS]);
  console.log("seed tables retired", sessions.rows.length, "sessions refunded");
} finally {
  await client.end();
}
