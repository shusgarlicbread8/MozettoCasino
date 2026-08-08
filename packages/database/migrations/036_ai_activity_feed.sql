-- Server-side AI activity feed.
--
-- The feed is an append-only event log, not derived UI state. Persisting it
-- means a refresh, a reconnect, a spectator joining late, and a replay all
-- reconstruct the identical timeline, and that the visible sequence numbers
-- are assigned once by the server rather than by array position in a browser.
--
-- PRIVACY: this table stores only sanitized, structured summaries — the same
-- owner-safe lines already broadcast over the socket. Raw model reasoning
-- (chain-of-thought) is never written here.

create table if not exists ai_activity_events (
  table_id      text not null,
  hand_id       text not null,
  seat_index    int  not null,
  -- Monotonic per (hand, seat). Assigned server-side; stable forever.
  seq           int  not null,
  kind          text not null check (kind in ('OBSERVATION','ANALYSIS','DECISION','ACTION','SYSTEM')),
  street        text,
  text          text not null,
  -- Owner of the seat, so the feed can be served to the right player only.
  owner_id      text,
  created_at    timestamptz not null default now(),
  primary key (hand_id, seat_index, seq)
);

-- Feed reconstruction is always "this hand, this seat, in order".
create index if not exists ai_activity_events_hand_seat_idx
  on ai_activity_events (hand_id, seat_index, seq);

-- Recent activity for a table, for late joiners and the session view.
create index if not exists ai_activity_events_table_idx
  on ai_activity_events (table_id, created_at desc);

-- TRANSIENT entries are deliberately NOT persisted: they describe work in
-- progress and are meaningless once the work has landed.
