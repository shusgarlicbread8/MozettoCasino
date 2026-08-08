import { z } from "zod";

export const CardSchema = z.object({
  rank: z.enum(["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"]),
  suit: z.enum(["c", "d", "h", "s"]),
});
export type Card = z.infer<typeof CardSchema>;

export const PokerActionSchema = z.enum(["fold", "check", "call", "bet", "raise", "all_in"]);
export type PokerAction = z.infer<typeof PokerActionSchema>;

export const StreetSchema = z.enum(["waiting", "dealing", "preflop", "flop", "turn", "river", "showdown", "settlement"]);
export type Street = z.infer<typeof StreetSchema>;

export const TableEventSchema = z.object({
  tableId: z.string(),
  handId: z.string().nullable(),
  sequence: z.number().int().nonnegative(),
  eventType: z.string(),
  timestamp: z.string(),
  payload: z.record(z.unknown()),
  prevEventHash: z.string().nullable(),
  eventHash: z.string(),
  visibility: z.enum(["public", "owner_private", "system"]).default("public"),
});
export type TableEvent = z.infer<typeof TableEventSchema>;

export const AgentRequestSchema = z.object({
  agentVersion: z.string(),
  profileKey: z.enum(["shark", "professor", "fox", "machine"]),
  game: z.literal("holdem"),
  legalActions: z.array(
    z.object({
      action: PokerActionSchema,
      minAmount: z.number().optional(),
      maxAmount: z.number().optional(),
    }),
  ),
  privateState: z.object({
    holeCards: z.array(CardSchema),
  }),
  publicState: z.object({
    board: z.array(CardSchema),
    pot: z.number(),
    callAmount: z.number(),
    street: StreetSchema,
    stacks: z.array(z.number()),
    toActSeat: z.number(),
  }),
  computeRemaining: z.number(),
  /**
   * Deterministic decision facts from `@mozetto/game-rules` (pot odds, SPR,
   * position, opponent range + equity-vs-range, candidate sizings).
   *
   * Kept as a passthrough record on the wire so the analytics layer can add
   * fields without a lockstep schema bump; `DecisionFacts` is the source of
   * truth for its shape.
   */
  facts: z.record(z.unknown()).optional(),
});
export type AgentRequest = z.infer<typeof AgentRequestSchema>;

export const AgentResponseSchema = z.object({
  action: PokerActionSchema,
  amount: z.number().optional(),
  reasonCode: z.string(),
  computeUsed: z.number(),
});
export type AgentResponse = z.infer<typeof AgentResponseSchema>;

export const LEAGUES = [
  { id: "bronze", name: "Bronze", color: "#B87333", minBuyIn: 10 },
  { id: "silver", name: "Silver", color: "#B8C0C8", minBuyIn: 50 },
  { id: "gold", name: "Gold", color: "#C9A227", minBuyIn: 250 },
  { id: "platinum", name: "Platinum", color: "#8FE3D2", minBuyIn: 1000 },
  { id: "diamond", name: "Diamond", color: "#8FB8FF", minBuyIn: 5000 },
  { id: "sovereign", name: "Sovereign", color: "#C89BFF", minBuyIn: 25000 },
] as const;

export * from "./seat-ticket";
export * from "./ws-protocol";
/** Canonical client schema: accepts legacy + Plan 19 v2 aliases (WP-110). */
export { WsClientMessageV2AcceptSchema as WsClientMessageSchema } from "./ws-protocol.js";
export type { WsClientMessageNormalized as WsClientMessage } from "./ws-protocol.js";

export const AI_PROFILES = [
  { key: "shark", label: "The Shark", blurb: "Aggressive opens and pressure on weaker ranges." },
  { key: "professor", label: "Professor", blurb: "Tight-aggressive, solver-flavored lines." },
  { key: "fox", label: "Fox", blurb: "Creative semi-bluffs and timed aggression." },
  { key: "machine", label: "Machine", blurb: "Low-variance, high-frequency value." },
] as const;
