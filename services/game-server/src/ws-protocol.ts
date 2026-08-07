/**
 * WP-110 — Game WS emit mode + outbound frame mapping.
 */

import {
  mapWsServerMessage,
  resolveGameWsEmitMode,
  type GameWsEmitMode,
} from "@mozetto/shared-types";

export const gameWsEmitMode: GameWsEmitMode = resolveGameWsEmitMode(process.env);

/** Wrap a raw socket.send so outbound frames respect GAME_WS_EMIT_V2. */
export function createWsSender(sendRaw: (data: unknown) => void): (data: unknown) => void {
  return (data: unknown) => {
    sendRaw(mapWsServerMessage(data, gameWsEmitMode));
  };
}
