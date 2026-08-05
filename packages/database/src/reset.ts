import { query } from "./client.js";
import { ensureAccountRatings } from "./ratings.js";
import { fakeDeposit } from "./ledger.js";

/**
 * Wipe game/rating/session history and reset every real account to a clean
 * $5,000 wallet with starting Glicko-2 ratings (1500 / RD 350). Dev/demo only.
 */
export async function resetAccountsToFresh(opts?: { startingBalance?: number }) {
  const starting = opts?.startingBalance ?? 5000;

  // 1. Vacate seats + force-complete any live sessions (no cashout — ledger is rebuilt below).
  await query(`update table_seats set status='empty', agent_id=null, owner_id=null, stack=0, updated_at=now()`);
  await query(
    `update table_sessions set status='completed', ended_at=coalesce(ended_at, now()), stack=0 where status='active'`,
  );

  // 2. Game history (order respects FKs).
  await query(`delete from agent_decisions`);
  await query(`delete from game_snapshots`).catch(() => null);
  await query(`delete from hand_events`);
  await query(`delete from hands`);
  await query(`delete from escrow_sessions`).catch(() => null);
  await query(`delete from settlements`).catch(() => null);
  await query(`delete from table_sessions`);

  // 3. Ratings / aggression.
  await query(`delete from rating_history`).catch(() => null);
  await query(`delete from rated_matches`).catch(() => null);
  await query(`delete from aggression_stats`).catch(() => null);
  await query(`delete from agent_records`).catch(() => null);
  await query(
    `update account_ratings set
       rating=1500, rd=350, volatility=0.06,
       matches_played=0, wins=0, losses=0, draws=0,
       hands_played=0, profit=0, provisional=true,
       last_rated_at=null, updated_at=now()`,
  ).catch(() => null);
  await query(`delete from ratings`).catch(() => null); // legacy per-agent Elo

  // 4. Retire every live table so matchmaking starts clean.
  await query(`update tables set is_active=false where is_active=true`);

  // 5. Clear notifications for a fresh inbox.
  await query(`delete from notifications`).catch(() => null);

  // 6. Reset every non-system profile: bronze league + $starting wallet.
  const profiles = await query<{ id: string; handle: string }>(
    `select id, handle from profiles where handle <> 'system'`,
  );

  for (const p of profiles.rows) {
    await query(`update profiles set league='bronze', active_arena_mode='demo' where id=$1`, [p.id]);
    await ensureAccountRatings(p.id).catch(() => null);

    // Wipe every ledger transaction that ever touched this user's accounts
    // (entries on both sides, so double-entry stays consistent), then fund $starting.
    const stamp = Date.now();
    await query(
      `delete from ledger_entries e
       where e.transaction_id in (
         select distinct e2.transaction_id
         from ledger_entries e2
         join ledger_accounts a on a.id = e2.account_id
         where a.owner_id = $1
       )`,
      [p.id],
    );
    await query(
      `delete from ledger_transactions t
       where not exists (select 1 from ledger_entries e where e.transaction_id = t.id)`,
    );

    await fakeDeposit(p.id, starting, `reset-fund-${p.id}-${stamp}`, "demo");
  }

  return {
    profiles: profiles.rows.length,
    startingBalance: starting,
  };
}
