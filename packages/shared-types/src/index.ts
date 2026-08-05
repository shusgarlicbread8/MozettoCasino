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
});
export type AgentRequest = z.infer<typeof AgentRequestSchema>;

export const AgentResponseSchema = z.object({
  action: PokerActionSchema,
  amount: z.number().optional(),
  reasonCode: z.string(),
  computeUsed: z.number(),
});
export type AgentResponse = z.infer<typeof AgentResponseSchema>;

export const WsClientMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("auth"), token: z.string() }),
  z.object({ type: z.literal("subscribe_table"), tableId: z.string(), role: z.enum(["player", "spectator"]) }),
  z.object({
    type: z.literal("join_table"),
    tableId: z.string(),
    buyIn: z.number(),
    agentConfigId: z.string(),
    seatIndex: z.number().optional(),
    stopLoss: z.number().optional(),
    profitTarget: z.number().optional(),
    maxDurationMinutes: z.number().optional(),
    autoRebuy: z.boolean().optional(),
  }),
  z.object({ type: z.literal("leave_table"), tableId: z.string() }),
  z.object({
    type: z.literal("player_action"),
    tableId: z.string(),
    action: PokerActionSchema,
    amount: z.number().optional(),
  }),
  z.object({
    type: z.literal("owner_command"),
    tableId: z.string(),
    command: z.enum(["sit_out", "resume", "top_up", "leave", "set_coaching_note"]),
    amount: z.number().optional(),
    note: z.string().optional(),
  }),
  z.object({ type: z.literal("replay_from"), tableId: z.string(), afterSequence: z.number() }),
  z.object({ type: z.literal("ping") }),
]);
export type WsClientMessage = z.infer<typeof WsClientMessageSchema>;

export const LEAGUES = [
  { id: "bronze", name: "Bronze", color: "#B87333", minBuyIn: 10 },
  { id: "silver", name: "Silver", color: "#B8C0C8", minBuyIn: 50 },
  { id: "gold", name: "Gold", color: "#C9A227", minBuyIn: 250 },
  { id: "platinum", name: "Platinum", color: "#8FE3D2", minBuyIn: 1000 },
  { id: "diamond", name: "Diamond", color: "#8FB8FF", minBuyIn: 5000 },
  { id: "sovereign", name: "Sovereign", color: "#C89BFF", minBuyIn: 25000 },
] as const;

export const AI_PROFILES = [
  { key: "shark", label: "The Shark", blurb: "Aggressive opens and pressure on weaker ranges." },
  { key: "professor", label: "Professor", blurb: "Tight-aggressive, solver-flavored lines." },
  { key: "fox", label: "Fox", blurb: "Creative semi-bluffs and timed aggression." },
  { key: "machine", label: "Machine", blurb: "Low-variance, high-frequency value." },
] as const;
