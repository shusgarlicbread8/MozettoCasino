"use client";

import { api } from "@/lib/api";
import { requireCityId, type CityRef } from "@mozetto/game-rules/cities";
import type { TicketParamsResponse } from "@mozetto/shared-types";
import type { Hex } from "viem";

/** Takes the city as `cityId` or the equivalent legacy `leagueId`. */
export async function signAndSubmitSeatTicket(opts: CityRef & {
  profileKey: string;
  signTypedDataAsync: (args: {
    domain: {
      name: string;
      version: string;
      chainId: number;
      verifyingContract: Hex;
    };
    types: Record<string, { name: string; type: string }[]>;
    primaryType: "SeatTicket";
    message: Record<string, unknown>;
  }) => Promise<Hex>;
}) {
  const cityId = requireCityId(opts);
  const params = await api<TicketParamsResponse & { player: string }>(
    `/v1/arena/ticket-params?cityId=${encodeURIComponent(cityId)}&leagueId=${encodeURIComponent(cityId)}&profileKey=${encodeURIComponent(opts.profileKey)}`,
  );

  const message = {
    player: params.player as Hex,
    gameTemplateId: params.gameTemplateId as Hex,
    buyIn: BigInt(params.buyIn),
    controllerHash: params.controllerHash as Hex,
    agentProfileHash: params.agentProfileHash as Hex,
    expiresAt: BigInt(params.expiresAt),
    nonce: BigInt(params.nonce),
    matchmakingPool: params.matchmakingPool as Hex,
  };

  const signature = await opts.signTypedDataAsync({
    domain: {
      ...params.domain,
      verifyingContract: params.domain.verifyingContract as Hex,
    },
    types: params.types,
    primaryType: "SeatTicket",
    message,
  });

  await api("/v1/arena/seat-ticket", {
    method: "POST",
    body: JSON.stringify({
      ...message,
      buyIn: params.buyIn,
      expiresAt: params.expiresAt,
      nonce: params.nonce,
      signature,
      cityId,
      leagueId: cityId,
    }),
  });

  return { ticketParams: params, signature };
}
