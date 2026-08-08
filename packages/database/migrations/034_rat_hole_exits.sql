-- Rat-hole tracking: last cash-out stack per owner × city (stake pool) × format.
-- Used by minimumReentryAtoms so a player who leaves deep cannot immediately
-- re-enter the same pool short within the cooldown window.

create table if not exists rat_hole_exits (
  owner_id text not null,
  city_id text not null,
  format text not null check (format in ('hu', 'sixmax')),
  leaving_stack_atoms numeric(78, 0) not null,
  left_at timestamptz not null default now(),
  primary key (owner_id, city_id, format)
);

create index if not exists rat_hole_exits_left_at_idx on rat_hole_exits (left_at);
