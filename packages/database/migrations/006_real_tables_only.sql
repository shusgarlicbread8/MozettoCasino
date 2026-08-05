-- Retire seeded demo tables so the lobby only shows player-created sessions.
-- Clear fake bot seats and any active sessions on those tables.

update tables
set is_active = false
where id in (
  'tbl_monaco_12',
  'tbl_emerald_4',
  'tbl_harbour_9',
  'tbl_viper_high',
  'tbl_seoul_2',
  'tbl_meridian_private'
)
or (created_by is null and id like 'tbl_%');

-- Empty seed seats so they cannot be joined / counted
update table_seats
set status = 'empty', agent_id = null, owner_id = null, stack = 0, updated_at = now()
where table_id in (
  'tbl_monaco_12',
  'tbl_emerald_4',
  'tbl_harbour_9',
  'tbl_viper_high',
  'tbl_seoul_2',
  'tbl_meridian_private'
);

-- Close leftover sessions on seed tables (funds stay in escrow ledger; leave path handles live tables)
update table_sessions
set status = 'completed', ended_at = coalesce(ended_at, now())
where status = 'active'
  and table_id in (
    'tbl_monaco_12',
    'tbl_emerald_4',
    'tbl_harbour_9',
    'tbl_viper_high',
    'tbl_seoul_2',
    'tbl_meridian_private'
  );
