import { z } from "zod";

/** Plan 05 internal dealer API shapes (enclave-facing). */

export const CommitBatchBody = z.object({
  sessionId: z.string().min(1),
  epoch: z.union([z.number().int().nonnegative(), z.string()]),
  secretCount: z.number().int().min(1).max(256).optional(),
});

export const BindVrfBody = z.object({
  sessionId: z.string().min(1),
  epoch: z.union([z.number().int().nonnegative(), z.string()]),
  vrfRequestId: z.string().min(1),
  vrfResultHash: z.string().min(1),
});

export const PrepareDecksBody = z.object({
  sessionId: z.string().min(1),
  epoch: z.union([z.number().int().nonnegative(), z.string()]),
  handNumbers: z.array(z.number().int().nonnegative()).min(1).max(256),
  /** Parallel to handNumbers — secret index per hand. */
  secretIndices: z.array(z.number().int().min(0).max(255)).min(1).max(256),
  vrfWord: z.string().min(1),
});

export const OpenPublicCardBody = z.object({
  sessionId: z.string().min(1),
  epoch: z.union([z.number().int().nonnegative(), z.string()]),
  handNumber: z.number().int().nonnegative(),
  secretIndex: z.number().int().min(0).max(255),
  vrfWord: z.string().min(1),
  position: z.number().int().min(0).max(51),
});

export const SeatIdentitySchema = z.object({
  seatIndex: z.number().int().min(0).max(9),
  x25519PublicKey: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  controllerAddress: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/)
    .optional(),
});

export const DeliverPrivateCardsBody = z.object({
  sessionId: z.string().min(1),
  epoch: z.union([z.number().int().nonnegative(), z.string()]),
  handNumber: z.number().int().nonnegative(),
  secretIndex: z.number().int().min(0).max(255),
  vrfWord: z.string().min(1),
  /** Hole card positions per seat (NLHE default [0,1] relative to deal order encoded by caller). */
  deals: z
    .array(
      z.object({
        seat: SeatIdentitySchema,
        positions: z.array(z.number().int().min(0).max(51)).min(1).max(2),
      }),
    )
    .min(1)
    .max(9),
});

export type CommitBatchBody = z.infer<typeof CommitBatchBody>;
export type BindVrfBody = z.infer<typeof BindVrfBody>;
export type PrepareDecksBody = z.infer<typeof PrepareDecksBody>;
export type OpenPublicCardBody = z.infer<typeof OpenPublicCardBody>;
export type DeliverPrivateCardsBody = z.infer<typeof DeliverPrivateCardsBody>;
