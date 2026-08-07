-- WP-090/085 inclusion-proof follow-up
-- Persist published proof batches + per-checkpoint Merkle inclusion proofs
-- for the public Verify Game surface (safe fields only; no private keys).

create table if not exists proof_batches (
  id uuid primary key default gen_random_uuid(),
  sequence bigint not null,
  previous_batch_root text not null,
  global_root text not null,
  data_manifest_hash text not null,
  proof_batch_hash text not null,
  created_at_chain bigint not null,
  tx_hash text,
  package_json jsonb,
  created_at timestamptz not null default now(),
  unique (sequence),
  unique (global_root),
  unique (proof_batch_hash)
);

create index if not exists proof_batches_created_idx
  on proof_batches (created_at desc);

create table if not exists proof_batch_inclusion_proofs (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references proof_batches(id) on delete cascade,
  session_id text not null,
  checkpoint_id bigint not null,
  checkpoint_root text not null,
  leaf_index int not null,
  merkle_proof jsonb not null,
  global_root text not null,
  batch_sequence bigint not null,
  verified_locally boolean not null default true,
  created_at timestamptz not null default now(),
  unique (batch_id, session_id, checkpoint_id)
);

create index if not exists proof_batch_inclusion_session_idx
  on proof_batch_inclusion_proofs (lower(session_id), checkpoint_id);

create index if not exists proof_batch_inclusion_root_idx
  on proof_batch_inclusion_proofs (lower(checkpoint_root));

create index if not exists proof_batch_inclusion_global_idx
  on proof_batch_inclusion_proofs (lower(global_root));
