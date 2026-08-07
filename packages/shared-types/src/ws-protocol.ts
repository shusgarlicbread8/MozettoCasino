/**
 * Game WebSocket protocol — legacy (v1) + Plan 19 v2 aliases (WP-110).
 *
 * Safe cutover:
 * - Inbound: always accept legacy + v2 message names (normalize → legacy).
 * - Outbound: default legacy; set GAME_WS_EMIT_V2=1 to emit v2 names.
 */

import { z } from "zod";

/** Local copy to avoid circular import with ./index.js. */
const PokerActionSchema = z.enum(["fold", "check", "call", "bet", "raise", "all_in"]);

/** Client message types (legacy names). */
export const WS_CLIENT_LEGACY_TYPES = [
  "auth",
  "subscribe_table",
  "join_table",
  "leave_table",
  "player_action",
  "owner_command",
  "replay_from",
  "ping",
] as const;

/** Plan 19 §WS client names → legacy. */
export const WS_CLIENT_V2_TO_LEGACY: Record<string, (typeof WS_CLIENT_LEGACY_TYPES)[number]> = {
  auth_v2: "auth",
  subscribe_table_v2: "subscribe_table",
  request_leave_v2: "leave_table",
  request_replay_v1: "replay_from",
  human_test_action_v1: "player_action",
  ping: "ping",
  // Keep join / owner / player_action as optional v2 aliases for gradual clients.
  join_table_v2: "join_table",
  player_action_v2: "player_action",
  owner_command_v2: "owner_command",
};

/** Plan 19 §WS server names (emit when GAME_WS_EMIT_V2=1). */
export const WS_SERVER_LEGACY_TO_V2: Record<string, string> = {
  hello: "hello_v2",
  snapshot: "snapshot_v2",
  event: "canonical_event_v1",
  private_state: "private_state_v2",
  error: "error_v2",
  // Lifecycle / energy / verification are additive; map when emitted.
  session_lifecycle: "session_lifecycle_v2",
  energy_summary: "energy_summary_v1",
  verification_update: "verification_update_v1",
  /** WP-126 owner-only AI Energy + public cognition phase. */
  ai_cognition: "ai_cognition_v1",
};

export type GameWsEmitMode = "legacy" | "v2";

export function resolveGameWsEmitMode(
  env: Record<string, string | undefined> = {},
): GameWsEmitMode {
  const raw = (env.GAME_WS_EMIT_V2 ?? env.GAME_WS_PROTOCOL ?? "legacy")
    .trim()
    .toLowerCase();
  if (raw === "1" || raw === "true" || raw === "v2" || raw === "emit_v2") {
    return "v2";
  }
  return "legacy";
}

/**
 * Rewrite inbound client `type` from v2 → legacy when needed.
 * Leaves already-legacy messages untouched.
 */
export function normalizeWsClientMessageType(type: unknown): string {
  if (typeof type !== "string") return String(type ?? "");
  return WS_CLIENT_V2_TO_LEGACY[type] ?? type;
}

/**
 * Normalize a parsed JSON object for legacy WsClientMessageSchema.
 * Mutates a shallow copy: remaps `type` and `afterSequence` alias if present.
 */
export function normalizeWsClientMessage(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const obj = { ...(raw as Record<string, unknown>) };
  const legacyType = normalizeWsClientMessageType(obj.type);
  obj.type = legacyType;

  // request_replay_v1 may use after_sequence snake_case from newer clients.
  if (legacyType === "replay_from" && obj.afterSequence == null && obj.after_sequence != null) {
    obj.afterSequence = obj.after_sequence;
    delete obj.after_sequence;
  }
  return obj;
}

/** Map outbound server frame type for emit mode. */
export function mapWsServerMessageType(
  type: string,
  mode: GameWsEmitMode = "legacy",
): string {
  if (mode !== "v2") return type;
  return WS_SERVER_LEGACY_TO_V2[type] ?? type;
}

export function mapWsServerMessage(
  data: unknown,
  mode: GameWsEmitMode = "legacy",
): unknown {
  if (mode !== "v2" || !data || typeof data !== "object" || Array.isArray(data)) {
    return data;
  }
  const obj = data as Record<string, unknown>;
  if (typeof obj.type !== "string") return data;
  const mapped = mapWsServerMessageType(obj.type, mode);
  if (mapped === obj.type) return data;
  const out: Record<string, unknown> = { ...obj, type: mapped };
  // protocolVersion bump for hello when emitting v2
  if (mapped === "hello_v2" && (out.protocolVersion === 1 || out.protocolVersion == null)) {
    out.protocolVersion = 2;
  }
  return out;
}

/**
 * Accept both legacy and v2 client envelopes, then validate as legacy shape.
 * Re-exported schema stays the canonical post-normalize contract.
 */
export const WsClientMessageV2AcceptSchema = z.preprocess(
  normalizeWsClientMessage,
  z.discriminatedUnion("type", [
    z.object({ type: z.literal("auth"), token: z.string() }),
    z.object({
      type: z.literal("subscribe_table"),
      tableId: z.string(),
      role: z.enum(["player", "spectator"]),
    }),
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
    z.object({
      type: z.literal("replay_from"),
      tableId: z.string(),
      afterSequence: z.number(),
    }),
    z.object({ type: z.literal("ping") }),
  ]),
);

export type WsClientMessageNormalized = z.infer<typeof WsClientMessageV2AcceptSchema>;
