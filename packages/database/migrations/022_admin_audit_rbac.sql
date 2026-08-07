-- WP-094: Admin audit log (append-only) + RBAC scaffolding.
-- Plan 13: immutable audit trail; read-only default; privileged actions audited.
-- Plan 19 §025 — admin_roles / admin_actions / principals (SSO/MFA-ready).

-- ---------------------------------------------------------------------------
-- Enrich admin_actions (canonical privileged audit trail)
-- ---------------------------------------------------------------------------
alter table admin_actions
  add column if not exists actor_label text,
  add column if not exists entity_type text,
  add column if not exists entity_id text,
  add column if not exists capability text,
  add column if not exists ip text,
  add column if not exists user_agent text;

create index if not exists admin_actions_created_idx
  on admin_actions (created_at desc);

create index if not exists admin_actions_entity_idx
  on admin_actions (entity_type, entity_id, created_at desc)
  where entity_id is not null;

create index if not exists admin_actions_action_idx
  on admin_actions (action, created_at desc);

-- Append-only: block UPDATE / DELETE at the database layer.
create or replace function admin_actions_reject_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'admin_actions is append-only (WP-094)';
end;
$$;

drop trigger if exists admin_actions_no_update on admin_actions;
create trigger admin_actions_no_update
  before update on admin_actions
  for each row execute function admin_actions_reject_mutation();

drop trigger if exists admin_actions_no_delete on admin_actions;
create trigger admin_actions_no_delete
  before delete on admin_actions
  for each row execute function admin_actions_reject_mutation();

-- ---------------------------------------------------------------------------
-- SSO / hardware-MFA ready principal registry (optional bindings)
-- Token secrets stay in env / IdP — never store raw tokens here.
-- ---------------------------------------------------------------------------
create table if not exists admin_principals (
  id uuid primary key default gen_random_uuid(),
  subject text not null unique,
  role text not null check (role in ('viewer', 'operator', 'risk', 'admin')),
  mfa_required boolean not null default true,
  disabled_at timestamptz,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists admin_principals_role_idx
  on admin_principals (role)
  where disabled_at is null;

-- ---------------------------------------------------------------------------
-- Narrow session ops overlays (no stack / balance edits)
-- Plan 13 allowed: pause after hand, under review, request replay.
-- ---------------------------------------------------------------------------
create table if not exists admin_session_ops (
  session_id text primary key,
  pause_after_hand boolean not null default false,
  under_review boolean not null default false,
  replay_requested boolean not null default false,
  notes text,
  updated_at timestamptz not null default now(),
  updated_by text
);

create index if not exists admin_session_ops_flags_idx
  on admin_session_ops (under_review, pause_after_hand, replay_requested)
  where under_review or pause_after_hand or replay_requested;

-- ---------------------------------------------------------------------------
-- RLS: enable with no permissive policies.
-- Supabase service_role / table-owner migrations bypass RLS; anon/auth JWT
-- clients see deny-by-default. Do not add using(true) — that weakens isolation.
-- ---------------------------------------------------------------------------
alter table admin_roles enable row level security;
alter table admin_actions enable row level security;
alter table admin_principals enable row level security;
alter table admin_session_ops enable row level security;
alter table security_incidents enable row level security;
