-- MC-100 / MC-103 — extend security_incidents + incident_events timeline (041).
-- Reuses existing security_incidents from 011; reconciliation worker already inserts rows.

alter table security_incidents
  add column if not exists source text,
  add column if not exists owner text,
  add column if not exists summary text,
  add column if not exists mitigation text,
  add column if not exists runbook_key text,
  add column if not exists postmortem_url text,
  add column if not exists auto_source_key text,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists security_incidents_status_created_idx
  on security_incidents (status, created_at desc);

create index if not exists security_incidents_auto_source_open_idx
  on security_incidents (auto_source_key)
  where status = 'open' and auto_source_key is not null;

create table if not exists incident_events (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references security_incidents(id) on delete cascade,
  event_type text not null,
  actor_label text,
  message text not null,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists incident_events_incident_created_idx
  on incident_events (incident_id, created_at desc);

alter table incident_events enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'mozetto_api') then
    grant select, insert, update on security_incidents to mozetto_api;
    grant select, insert on incident_events to mozetto_api;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update on security_incidents to service_role;
    grant select, insert on incident_events to service_role;
  end if;
end $$;
