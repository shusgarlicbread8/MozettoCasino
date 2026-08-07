-- WP-060 / Plan 19 §019 — Canonical poker events V1 (PokerEventV1 hash chain).
-- Extends legacy `canonical_game_events` (migration 011) with ABI canonical bytes,
-- resulting state hash, epoch/hand numbering, and typed actor fields.
-- Does NOT remove legacy JSON columns used by the current game-server path.
-- Full cutover of game-server / replay-verifier to PokerEventV1 is a follow-up.

alter table canonical_game_events
  add column if not exists epoch bigint not null default 0,
  add column if not exists hand_number bigint,
  add column if not exists protocol_version int not null default 3,
  add column if not exists event_type_code int,
  add column if not exists has_actor_seat boolean,
  add column if not exists actor_seat smallint,
  add column if not exists public_payload_hash text,
  add column if not exists elapsed_ms bigint,
  add column if not exists canonical_bytes bytea,
  add column if not exists resulting_state_hash text,
  add column if not exists actor_identity text,
  add column if not exists schema_kind text not null default 'legacy_json'
    check (schema_kind in ('legacy_json', 'poker_event_v1'));

comment on column canonical_game_events.canonical_bytes is
  'ABI-encoded PokerEventV1 eventHash preimage (DOMAIN + 13 fields). Null for legacy_json rows.';
comment on column canonical_game_events.resulting_state_hash is
  'Engine/snapshot digest after applying this event; not part of eventHash.';
comment on column canonical_game_events.schema_kind is
  'legacy_json = game-server mozetto-poker-v1 JSON keccak; poker_event_v1 = MOZETTO_POKER_EVENT_V1.';

-- Plan 19 unique constraints (session, epoch, sequence) + event_hash uniqueness.
-- Keep existing unique (session_id, sequence) for backward compat; add epoch-aware index.
create unique index if not exists canonical_game_events_session_epoch_seq_uidx
  on canonical_game_events (session_id, epoch, sequence);

create unique index if not exists canonical_game_events_event_hash_uidx
  on canonical_game_events (event_hash);

create index if not exists canonical_game_events_session_hand_idx
  on canonical_game_events (session_id, epoch, hand_number);

-- Projection / ciphertext companions (Plan 19). Soft FK via event_hash text
-- (no hard REFERENCES) so append-order and legacy rows stay flexible until WP-081.
create table if not exists public_event_payloads (
  id uuid primary key default gen_random_uuid(),
  event_hash text not null unique,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists private_payload_ciphertexts (
  id uuid primary key default gen_random_uuid(),
  event_hash text not null unique,
  ciphertext bytea not null,
  commitment text not null,
  created_at timestamptz not null default now()
);

create table if not exists event_persistence_outbox (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  epoch bigint not null default 0,
  sequence bigint not null,
  event_hash text not null,
  status text not null default 'pending'
    check (status in ('pending', 'published', 'failed')),
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  unique (session_id, epoch, sequence)
);
