-- MC-010–015: Mozetto Control wallet SIWE auth (admin_siwe_nonces, admin_sessions, roles).

-- ---------------------------------------------------------------------------
-- Extend admin_principals roles for Control (keep admin for back-compat)
-- ---------------------------------------------------------------------------
alter table admin_principals drop constraint if exists admin_principals_role_check;
alter table admin_principals add constraint admin_principals_role_check
  check (role in (
    'viewer', 'support', 'risk', 'operator', 'finance', 'auditor', 'superadmin', 'admin'
  ));

-- ---------------------------------------------------------------------------
-- Admin SIWE nonces (single-use, hashed at rest)
-- ---------------------------------------------------------------------------
create table if not exists admin_siwe_nonces (
  id uuid primary key default gen_random_uuid(),
  nonce_hash text not null unique,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  request_ip_hash text,
  user_agent_hash text
);

create index if not exists admin_siwe_nonces_expires_idx
  on admin_siwe_nonces (expires_at)
  where consumed_at is null;

-- ---------------------------------------------------------------------------
-- Server-side admin sessions (revocable; distinct from player mozetto_session)
-- ---------------------------------------------------------------------------
create table if not exists admin_sessions (
  id uuid primary key default gen_random_uuid(),
  principal_id uuid not null references admin_principals(id),
  wallet_address text not null,
  role text not null,
  capabilities jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by text,
  auth_method text not null check (auth_method in ('siwe', 'token')),
  step_up_at timestamptz,
  ip_hash text,
  user_agent_hash text
);

create index if not exists admin_sessions_active_idx
  on admin_sessions (id)
  where revoked_at is null;

create index if not exists admin_sessions_principal_idx
  on admin_sessions (principal_id, created_at desc);

create index if not exists admin_sessions_wallet_idx
  on admin_sessions (lower(wallet_address), created_at desc);

-- ---------------------------------------------------------------------------
-- RLS: deny-by-default (service_role / owner bypass)
-- ---------------------------------------------------------------------------
alter table admin_siwe_nonces enable row level security;
alter table admin_sessions enable row level security;

-- ---------------------------------------------------------------------------
-- Least-privilege grants for mozetto_api (when role exists)
-- ---------------------------------------------------------------------------
create or replace function _mc037_grant_table(
  p_role text,
  p_privs text,
  p_table text
) returns void
language plpgsql
as $$
begin
  if not exists (select 1 from pg_roles where rolname = p_role) then
    return;
  end if;
  if to_regclass(format('%I.%I', 'public', p_table)) is null then
    return;
  end if;
  execute format('grant %s on table public.%I to %I', p_privs, p_table, p_role);
exception
  when insufficient_privilege then
    null;
end;
$$;

select _mc037_grant_table('mozetto_api', 'select, insert, update', 'admin_siwe_nonces');
select _mc037_grant_table('mozetto_api', 'select, insert, update', 'admin_sessions');
select _mc037_grant_table('mozetto_api', 'select', 'admin_principals');

drop function if exists _mc037_grant_table(text, text, text);

comment on table admin_siwe_nonces is
  'Mozetto Control SIWE login nonces — single-use, hashed; MC-010.';
comment on table admin_sessions is
  'Mozetto Control server-side admin sessions — revocable; MC-011.';
