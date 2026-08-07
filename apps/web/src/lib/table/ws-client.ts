/**
 * Game-server WS helpers — dual-accept legacy + WP-110 v2 aliases (Plan 19).
 * No protocol field inventions; names only.
 */

/** Server frames: v2 → legacy (client normalize). */
const SERVER_V2_TO_LEGACY: Record<string, string> = {
  hello_v2: "hello",
  snapshot_v2: "snapshot",
  canonical_event_v1: "event",
  private_state_v2: "private_state",
  error_v2: "error",
  session_lifecycle_v2: "session_lifecycle",
  energy_summary_v1: "energy_summary",
  verification_update_v1: "verification_update",
  /** WP-126 owner-only Energy + public cognition phase. */
  ai_cognition_v1: "ai_cognition",
};

/** Prefer v2 client sends; server dual-accepts (WP-110). */
export const WS_CLIENT = {
  auth: "auth_v2",
  subscribe_table: "subscribe_table_v2",
  player_action: "player_action_v2",
  leave_table: "request_leave_v2",
  ping: "ping",
} as const;

export type NormalizedWsMessage = Record<string, unknown> & { type: string };

export function normalizeServerWsMessage(raw: unknown): NormalizedWsMessage | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.type !== "string") return null;
  const type = SERVER_V2_TO_LEGACY[obj.type] ?? obj.type;
  if (type === obj.type) return obj as NormalizedWsMessage;
  return { ...obj, type } as NormalizedWsMessage;
}

export function parseServerWsData(data: string): NormalizedWsMessage | null {
  try {
    return normalizeServerWsMessage(JSON.parse(data));
  } catch {
    return null;
  }
}
