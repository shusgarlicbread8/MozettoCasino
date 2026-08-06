-- Track which vault deployment the indexer cursor belongs to (Anvil redeploy safety).
alter table chain_cursors
  add column if not exists vault_address text,
  add column if not exists deployment_block bigint not null default 0;
