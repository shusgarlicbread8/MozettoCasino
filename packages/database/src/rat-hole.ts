/**
 * Persist / query last cash-out stacks for anti rat-holing.
 */
import {
  minimumReentryAtoms,
  requireCity,
  usdcToAtoms,
  type CityId,
} from "@mozetto/game-rules";
import { query } from "./client.js";

export type TableFormat = "hu" | "sixmax";

export async function recordRatHoleExit(input: {
  ownerId: string;
  cityId: string;
  format: TableFormat;
  /** Leaving stack in USDC dollars (table/session scale). */
  leavingStackUsd: number;
}): Promise<void> {
  const atoms = usdcToAtoms(input.leavingStackUsd);
  await query(
    `insert into rat_hole_exits (owner_id, city_id, format, leaving_stack_atoms, left_at)
     values ($1, $2, $3, $4::numeric, now())
     on conflict (owner_id, city_id, format) do update set
       leaving_stack_atoms = excluded.leaving_stack_atoms,
       left_at = excluded.left_at`,
    [input.ownerId, input.cityId, input.format, atoms.toString()],
  );
}

export async function getRatHoleFloorAtoms(input: {
  ownerId: string;
  cityId: string;
  format: TableFormat;
}): Promise<bigint> {
  const city = requireCity(input.cityId);
  const row = await query<{ leaving_stack_atoms: string; left_at: Date | string }>(
    `select leaving_stack_atoms, left_at from rat_hole_exits
     where owner_id=$1 and city_id=$2 and format=$3`,
    [input.ownerId, input.cityId, input.format],
  );
  const hit = row.rows[0];
  if (!hit) {
    return minimumReentryAtoms({
      city,
      lastLeavingStackAtoms: null,
      msSinceLeaving: null,
    });
  }
  const leftAt = new Date(hit.left_at).getTime();
  const msSinceLeaving = Date.now() - leftAt;
  return minimumReentryAtoms({
    city,
    lastLeavingStackAtoms: BigInt(hit.leaving_stack_atoms),
    msSinceLeaving,
  });
}

/** Validate a requested buy-in (atoms) against rat-hole floor for this pool. */
export async function assertBuyInClearsRatHole(input: {
  ownerId: string;
  cityId: CityId | string;
  format: TableFormat;
  buyInAtoms: bigint;
}): Promise<{ ok: true } | { ok: false; minAtoms: bigint; message: string }> {
  const minAtoms = await getRatHoleFloorAtoms({
    ownerId: input.ownerId,
    cityId: input.cityId,
    format: input.format,
  });
  if (input.buyInAtoms < minAtoms) {
    const city = requireCity(input.cityId);
    return {
      ok: false,
      minAtoms,
      message: `Anti rat-hole: minimum re-entry for ${city.name} is currently above your requested buy-in. Wait for the cooldown or buy in deeper.`,
    };
  }
  return { ok: true };
}
