-- WP-112 — session checkpoint → proof-batch publisher feeder
-- Extends session_checkpoints so settlement/game can emit leaves and the
-- proof-batch publisher can claim/drain them into ProofBatchRegistry batches.

alter table session_checkpoints
  add column if not exists checkpoint_root text,
  add column if not exists proof_batch_claimed_at timestamptz,
  add column if not exists proof_batch_sequence bigint;

comment on column session_checkpoints.checkpoint_root is
  'Season-1 TableCheckpointRoot = keccak256(abi.encode(eventRoot, balanceRoot)); leaf under ProofBatch globalRoot.';
comment on column session_checkpoints.proof_batch_claimed_at is
  'Publisher claim lease; null or expired rows are eligible for drainPending.';
comment on column session_checkpoints.proof_batch_sequence is
  'ProofBatchRegistry sequence that included this checkpoint (null = unpublished).';

create index if not exists session_checkpoints_unbatched_idx
  on session_checkpoints (created_at asc)
  where proof_batch_sequence is null;

create index if not exists session_checkpoints_claim_idx
  on session_checkpoints (proof_batch_claimed_at)
  where proof_batch_sequence is null;
