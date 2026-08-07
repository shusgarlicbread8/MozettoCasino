-- Plan 19 §017 — Protocol versions and content-addressed manifests.
-- Coordinates activation of protocol / engine / policy artifacts without
-- inventing on-chain money or poker authority. Indexer + ops writers only.

create table if not exists protocol_versions (
  id uuid primary key default gen_random_uuid(),
  semantic_version text not null,
  canonical_hash text not null,
  status text not null default 'draft'
    check (status in ('draft', 'active', 'deprecated', 'retired')),
  activation_block bigint,
  activation_at timestamptz,
  deactivation_block bigint,
  deactivation_at timestamptz,
  source_commit text,
  notes text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (semantic_version),
  unique (canonical_hash)
);

create table if not exists protocol_artifacts (
  id uuid primary key default gen_random_uuid(),
  protocol_version_id uuid references protocol_versions(id) on delete cascade,
  artifact_kind text not null
    check (artifact_kind in (
      'spec',
      'vector_pack',
      'solidity_build',
      'ts_package',
      'rust_crate',
      'wasm_build',
      'other'
    )),
  content_address text not null,
  uri text,
  reproducible_build jsonb not null default '{}'::jsonb,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (artifact_kind, content_address)
);

create index if not exists protocol_artifacts_version_idx
  on protocol_artifacts (protocol_version_id);

create table if not exists game_template_manifests (
  id uuid primary key default gen_random_uuid(),
  template_id text not null,
  semantic_version text not null,
  manifest_hash text not null,
  protocol_version text,
  status text not null default 'draft'
    check (status in ('draft', 'active', 'deprecated', 'retired')),
  activation_block bigint,
  activation_at timestamptz,
  deactivation_at timestamptz,
  source_commit text,
  manifest jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (template_id, semantic_version),
  unique (manifest_hash)
);

create table if not exists engine_builds (
  id uuid primary key default gen_random_uuid(),
  engine_id text not null,
  semantic_version text not null,
  engine_hash text not null,
  language text not null check (language in ('ts', 'rust', 'wasm', 'other')),
  status text not null default 'draft'
    check (status in ('draft', 'active', 'deprecated', 'retired')),
  source_commit text,
  reproducible_build jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (engine_id, semantic_version),
  unique (engine_hash)
);

create table if not exists model_policy_versions (
  id uuid primary key default gen_random_uuid(),
  policy_key text not null,
  semantic_version text not null,
  policy_hash text not null,
  status text not null default 'draft'
    check (status in ('draft', 'active', 'deprecated', 'retired')),
  source_commit text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (policy_key, semantic_version),
  unique (policy_hash)
);

create table if not exists energy_policy_versions (
  id uuid primary key default gen_random_uuid(),
  policy_key text not null,
  semantic_version text not null,
  energy_policy_hash text not null,
  status text not null default 'draft'
    check (status in ('draft', 'active', 'deprecated', 'retired')),
  source_commit text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (policy_key, semantic_version),
  unique (energy_policy_hash)
);

create table if not exists profile_set_versions (
  id uuid primary key default gen_random_uuid(),
  profile_set_key text not null,
  semantic_version text not null,
  profile_set_hash text not null,
  status text not null default 'draft'
    check (status in ('draft', 'active', 'deprecated', 'retired')),
  source_commit text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (profile_set_key, semantic_version),
  unique (profile_set_hash)
);

-- Do not seed placeholder hashes — insert real content-addressed rows from
-- frozen vectors / reproducible builds when activating a season.

alter table protocol_versions enable row level security;
alter table protocol_artifacts enable row level security;
alter table game_template_manifests enable row level security;
alter table engine_builds enable row level security;
alter table model_policy_versions enable row level security;
alter table energy_policy_versions enable row level security;
alter table profile_set_versions enable row level security;
