import { query } from "./client.js";

export type ArenaAccountRow = {
  id: string;
  profile_id: string;
  chain_id: number;
  owner_address: string;
  arena_account_address: string;
  factory_address: string | null;
  implementation_address: string | null;
  deployment_status: "predicted" | "pending" | "deployed" | "failed";
  deploy_tx_hash: string | null;
};

export async function upsertArenaAccount(opts: {
  profileId: string;
  chainId: number;
  ownerAddress: string;
  arenaAccountAddress: string;
  factoryAddress?: string | null;
  implementationAddress?: string | null;
  deploymentStatus?: ArenaAccountRow["deployment_status"];
  deployTxHash?: string | null;
}): Promise<ArenaAccountRow> {
  const status = opts.deploymentStatus ?? "predicted";
  const row = await query<ArenaAccountRow>(
    `insert into arena_accounts (
       profile_id, chain_id, owner_address, arena_account_address,
       factory_address, implementation_address, deployment_status, deploy_tx_hash,
       deployed_at, updated_at
     ) values ($1,$2,lower($3),lower($4),$5,$6,$7,$8,
       case when $7 = 'deployed' then now() else null end, now())
     on conflict (chain_id, owner_address) do update set
       arena_account_address = excluded.arena_account_address,
       factory_address = coalesce(excluded.factory_address, arena_accounts.factory_address),
       implementation_address = coalesce(excluded.implementation_address, arena_accounts.implementation_address),
       deployment_status = case
         when arena_accounts.deployment_status = 'deployed' then 'deployed'
         else excluded.deployment_status
       end,
       deploy_tx_hash = coalesce(excluded.deploy_tx_hash, arena_accounts.deploy_tx_hash),
       deployed_at = case
         when excluded.deployment_status = 'deployed' then coalesce(arena_accounts.deployed_at, now())
         else arena_accounts.deployed_at
       end,
       updated_at = now()
     returning *`,
    [
      opts.profileId,
      opts.chainId,
      opts.ownerAddress,
      opts.arenaAccountAddress,
      opts.factoryAddress ?? null,
      opts.implementationAddress ?? null,
      status,
      opts.deployTxHash ?? null,
    ],
  );
  return row.rows[0]!;
}

export async function getArenaAccountByOwner(
  ownerAddress: string,
  chainId: number,
): Promise<ArenaAccountRow | null> {
  const row = await query<ArenaAccountRow>(
    `select * from arena_accounts where chain_id = $1 and lower(owner_address) = lower($2) limit 1`,
    [chainId, ownerAddress],
  );
  return row.rows[0] ?? null;
}

export async function getArenaAccountByAddress(
  arenaAccountAddress: string,
  chainId?: number,
): Promise<ArenaAccountRow | null> {
  const row = await query<ArenaAccountRow>(
    chainId != null
      ? `select * from arena_accounts where chain_id = $1 and lower(arena_account_address) = lower($2) limit 1`
      : `select * from arena_accounts where lower(arena_account_address) = lower($1) limit 1`,
    chainId != null ? [chainId, arenaAccountAddress] : [arenaAccountAddress],
  );
  return row.rows[0] ?? null;
}

export async function getArenaAccountByProfile(
  profileId: string,
  chainId: number,
): Promise<ArenaAccountRow | null> {
  const row = await query<ArenaAccountRow>(
    `select * from arena_accounts where profile_id = $1 and chain_id = $2 limit 1`,
    [profileId, chainId],
  );
  return row.rows[0] ?? null;
}

export async function markArenaAccountDeployed(
  ownerAddress: string,
  chainId: number,
  txHash: string,
): Promise<void> {
  await query(
    `update arena_accounts
     set deployment_status = 'deployed', deploy_tx_hash = $3, deployed_at = coalesce(deployed_at, now()), updated_at = now()
     where chain_id = $1 and lower(owner_address) = lower($2)`,
    [chainId, ownerAddress, txHash],
  );
}

export async function reserveExposure(opts: {
  profileId: string;
  chainId: number;
  arenaAccountAddress: string;
  buyInRaw: string;
  batchId?: string | null;
  sessionId?: string | null;
  ttlSeconds?: number;
}): Promise<string> {
  const ttl = opts.ttlSeconds ?? 120;
  const row = await query<{ id: string }>(
    `insert into arena_exposure_reservations (
       profile_id, chain_id, arena_account_address, session_id, batch_id, buy_in_raw, status, expires_at
     ) values ($1,$2,lower($3),$4,$5,$6::numeric,'reserved', now() + ($7 || ' seconds')::interval)
     returning id`,
    [
      opts.profileId,
      opts.chainId,
      opts.arenaAccountAddress,
      opts.sessionId ?? null,
      opts.batchId ?? null,
      opts.buyInRaw,
      String(ttl),
    ],
  );
  return row.rows[0]!.id;
}

export async function confirmExposure(reservationId: string, sessionId: string): Promise<void> {
  await query(
    `update arena_exposure_reservations
     set status = 'confirmed', session_id = $2, updated_at = now()
     where id = $1 and status = 'reserved'`,
    [reservationId, sessionId],
  );
}

export async function releaseExposure(reservationId: string): Promise<void> {
  await query(
    `update arena_exposure_reservations
     set status = 'released', updated_at = now()
     where id = $1 and status in ('reserved','confirmed')`,
    [reservationId],
  );
}

export async function expireStaleExposures(): Promise<number> {
  const row = await query(
    `update arena_exposure_reservations
     set status = 'expired', updated_at = now()
     where status = 'reserved' and expires_at < now()`,
  );
  return row.rowCount ?? 0;
}

export async function sumReservedExposure(
  arenaAccountAddress: string,
  chainId: number,
): Promise<{ reservedRaw: bigint; reservedGames: number }> {
  await expireStaleExposures();
  const row = await query<{ reserved_raw: string; reserved_games: string }>(
    `select coalesce(sum(buy_in_raw), 0)::text as reserved_raw,
            count(*)::text as reserved_games
     from arena_exposure_reservations
     where chain_id = $1 and lower(arena_account_address) = lower($2) and status = 'reserved'`,
    [chainId, arenaAccountAddress],
  );
  return {
    reservedRaw: BigInt(row.rows[0]?.reserved_raw ?? "0"),
    reservedGames: Number(row.rows[0]?.reserved_games ?? 0),
  };
}

/** Resolve profile for indexer: ArenaAccount first, then owner wallet_identities. */
export async function resolveProfileForChainAddress(
  address: string,
  chainId: number,
): Promise<string | null> {
  const aa = await query<{ profile_id: string }>(
    `select profile_id from arena_accounts
     where chain_id = $1 and lower(arena_account_address) = lower($2)
     limit 1`,
    [chainId, address],
  );
  if (aa.rows[0]?.profile_id) return aa.rows[0].profile_id;

  const wi = await query<{ profile_id: string }>(
    `select coalesce(profile_id, user_id)::text as profile_id
     from wallet_identities
     where lower(address) = lower($1)
     limit 1`,
    [address],
  );
  return wi.rows[0]?.profile_id ?? null;
}
