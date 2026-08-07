-- WP-081 / Plan 07 — Persist-before-broadcast outbox.
-- Extends migration 019 `event_persistence_outbox` with broadcast payload so
-- undelivered rows can be republished after restart without re-deriving WS frames.
-- Plan 07 name `broadcast_outbox` is a synonym view for operators.

alter table event_persistence_outbox
  add column if not exists table_id text;

alter table event_persistence_outbox
  add column if not exists channel text not null default 'table:public';

alter table event_persistence_outbox
  add column if not exists payload jsonb not null default '{}'::jsonb;

alter table event_persistence_outbox
  add column if not exists schema_kind text not null default 'legacy_json';

alter table event_persistence_outbox
  add column if not exists visibility text not null default 'public';

comment on column event_persistence_outbox.payload is
  'WS frame body (TableEvent projection) — published only after durable commit.';
comment on column event_persistence_outbox.schema_kind is
  'legacy_json = mozetto-poker-v1 / hand_events keccak; poker_event_v1 = MOZETTO_POKER_EVENT_V1.';
comment on column event_persistence_outbox.table_id is
  'Game table id for hand_events path; may match session_id for demo tables.';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'event_persistence_outbox_schema_kind_check'
  ) then
    alter table event_persistence_outbox
      add constraint event_persistence_outbox_schema_kind_check
      check (schema_kind in ('legacy_json', 'poker_event_v1'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'event_persistence_outbox_visibility_check'
  ) then
    alter table event_persistence_outbox
      add constraint event_persistence_outbox_visibility_check
      check (visibility in ('public', 'owner_private', 'system'));
  end if;
end $$;

create index if not exists event_persistence_outbox_pending_idx
  on event_persistence_outbox (status, created_at)
  where status = 'pending';

create index if not exists event_persistence_outbox_table_pending_idx
  on event_persistence_outbox (table_id, status)
  where status = 'pending';

-- Operator-facing synonym (Plan 07 table name).
create or replace view broadcast_outbox as
  select * from event_persistence_outbox;
