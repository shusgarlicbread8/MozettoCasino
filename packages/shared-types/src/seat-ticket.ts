import { z } from "zod";

/** keccak256("NLHE_HU_STANDARD_V1") — must match ArenaVaultV1 / TableRegistryV1. */
export const NLHE_HU_STANDARD_V1_TEMPLATE_ID =
  "0x028ae0f374b4b519f80e5091d040e5c18e795508c1fdc8838d67edcdf51043b3" as const;

export const POKER_ENGINE_HASH =
  "0xc4495078b280cc1544d6ec2b6b38a8647f619eaa31b655fb8675ed3a2e00822e" as const;

export const PROFILE_SET_HASH =
  "0xb19aef4953947932cb6e89b956181a83a66ad886fd63479413b3d894f1a45431" as const;

export const CONTROLLER_HASH =
  "0xf6a560e6a5d18fd972f72d7dc98f22bf26dce5e8c7962ef3d565963efde2e32e" as const;

const hex32 = z.string().regex(/^0x[a-fA-F0-9]{64}$/);
const address = z.string().regex(/^0x[a-fA-F0-9]{40}$/i);

export const SeatTicketMessageSchema = z.object({
  player: address,
  gameTemplateId: hex32,
  buyIn: z.union([z.string(), z.number(), z.bigint()]),
  controllerHash: hex32,
  agentProfileHash: hex32,
  expiresAt: z.union([z.number().int().positive(), z.string(), z.bigint()]),
  nonce: z.union([z.string(), z.number(), z.bigint()]),
  matchmakingPool: hex32,
});
export type SeatTicketMessage = z.infer<typeof SeatTicketMessageSchema>;

export const SubmitSeatTicketSchema = SeatTicketMessageSchema.extend({
  signature: z.string().regex(/^0x[a-fA-F0-9]+$/),
  leagueId: z.string().min(1).optional(),
});
export type SubmitSeatTicket = z.infer<typeof SubmitSeatTicketSchema>;

export const TicketParamsQuerySchema = z.object({
  leagueId: z.string().min(1),
  profileKey: z.enum(["shark", "professor", "fox", "machine"]).optional(),
});
export type TicketParamsQuery = z.infer<typeof TicketParamsQuerySchema>;

export const SeatTicketDomainSchema = z.object({
  name: z.literal("MozettoArenaVault"),
  version: z.literal("1"),
  chainId: z.number().int().positive(),
  verifyingContract: address,
});

export const TicketParamsResponseSchema = z.object({
  gameTemplateId: hex32,
  buyIn: z.string(),
  buyInUsdc: z.number(),
  nonce: z.string(),
  expiresAt: z.number().int().positive(),
  controllerHash: hex32,
  agentProfileHash: hex32,
  matchmakingPool: hex32,
  domain: SeatTicketDomainSchema,
  types: z.record(z.array(z.object({ name: z.string(), type: z.string() }))),
  chainId: z.number().int().positive(),
  vault: address,
  leagueId: z.string(),
});
export type TicketParamsResponse = z.infer<typeof TicketParamsResponseSchema>;
