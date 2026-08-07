-- WP-083: reconciliation differences + ops pause metadata.
-- Plan 19 §023 — reconciliation_differences (severity, automatic action, evidence, resolution).

create table if not exists reconciliation_differences (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references reconciliation_runs(id) on delete cascade,
  chain_id int not null,
  check_id text not null,
  severity text not null
    check (severity in ('critical', 'warning', 'info')),
  automatic_action text not null default 'none'
    check (automatic_action in ('pause_new_sessions', 'none')),
  ok boolean not null default false,
  message text not null,
  evidence jsonb not null default '{}',
  status text not null default 'open'
    check (status in ('open', 'acknowledged', 'resolved', 'false_positive')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution_note text
);

create index if not exists reconciliation_differences_run_idx
  on reconciliation_differences (run_id);

create index if not exists reconciliation_differences_open_idx
  on reconciliation_differences (status, severity, created_at desc)
  where status = 'open';

-- Ensure pause flag exists (idempotent with 011 seed).
insert into feature_flags (key, enabled, meta) values
  ('onchain_matchmaking', true, '{"note":"disabled automatically on reconciliation failure (WP-083)"}')
on conflict (key) do nothing;
