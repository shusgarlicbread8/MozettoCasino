"use client";

import { useEffect, useRef, useState } from "react";
import {
  emptyAiCognitionStatus,
  inferPhaseFromPublicEvent,
  parseAiCognitionMessage,
  type AiCognitionStatus,
  type PublicAiCognitionPhase,
} from "./ai-cognition";

type PublicEventLike = {
  eventType?: string;
  payload?: Record<string, unknown>;
};

/**
 * WP-126 — subscribe to owner `ai_cognition` frames + honest public-event fallback.
 * Prefer real cognition/cadence/Energy signals; never invent CoT.
 */
export function useAiCognition(opts: {
  /** Own seated index; null when spectating. */
  mySeatIndex: number | null;
  /** Current hand id for reset detection. */
  handId: string | null;
  /** Optional: feed WS messages from the table page. */
  lastWsMessage?: unknown;
  /** Optional: feed table events from the table page. */
  lastTableEvent?: PublicEventLike | null;
  /** When true, briefly hold ACTING then drop to OBSERVING if no newer signal. */
  autoSettleActingMs?: number;
}): AiCognitionStatus {
  const { mySeatIndex, handId, lastWsMessage, lastTableEvent, autoSettleActingMs = 900 } = opts;
  const [status, setStatus] = useState<AiCognitionStatus>(() => emptyAiCognitionStatus());
  const lastEnergyRef = useRef<number | null>(null);
  const lastHandRef = useRef<string | null>(null);

  useEffect(() => {
    if (handId && handId !== lastHandRef.current) {
      lastHandRef.current = handId;
      lastEnergyRef.current = null;
      setStatus(
        emptyAiCognitionStatus({
          phase: "OBSERVING",
          handId,
          seat: mySeatIndex,
          signalSource: "unavailable",
        }),
      );
    }
  }, [handId, mySeatIndex]);

  useEffect(() => {
    const parsed = parseAiCognitionMessage(lastWsMessage);
    if (!parsed) return;
    if (mySeatIndex != null && parsed.seat != null && parsed.seat !== mySeatIndex) return;
    if (parsed.energyRemaining != null) lastEnergyRef.current = parsed.energyRemaining;
    setStatus((prev) => {
      const incoming = parsed.publicThinkingLog ?? [];
      const mergedLog =
        incoming.length > 0
          ? [...(prev.publicThinkingLog ?? []).filter((l) => !incoming.includes(l)), ...incoming].slice(
              -12,
            )
          : prev.publicThinkingLog ?? null;
      return {
        ...parsed,
        energyRemaining: parsed.energyRemaining ?? lastEnergyRef.current,
        seat: parsed.seat ?? mySeatIndex,
        publicThinkingLog: mergedLog,
        publicNarrative: parsed.publicNarrative ?? prev.publicNarrative,
      };
    });
  }, [lastWsMessage, mySeatIndex]);

  useEffect(() => {
    if (!lastTableEvent?.eventType) return;
    setStatus((prev) => {
      // Prefer live cognition frames over inference when recent.
      if (prev.signalSource === "cognition" && Date.now() - prev.atMs < 4_000) {
        return prev;
      }
      const next = inferPhaseFromPublicEvent({
        eventType: lastTableEvent.eventType!,
        payload: lastTableEvent.payload ?? {},
        mySeatIndex,
        prev,
      });
      if (!next) return prev;
      if (next.energyRemaining != null) lastEnergyRef.current = next.energyRemaining;
      return {
        ...next,
        energyRemaining: next.energyRemaining ?? lastEnergyRef.current,
      };
    });
  }, [lastTableEvent, mySeatIndex]);

  useEffect(() => {
    if (status.phase !== "ACTING") return;
    const t = setTimeout(() => {
      setStatus((prev) => {
        if (prev.phase !== "ACTING") return prev;
        if (prev.signalSource === "cognition" && Date.now() - prev.atMs < autoSettleActingMs) {
          return prev;
        }
        return { ...prev, phase: "OBSERVING" as PublicAiCognitionPhase, atMs: Date.now() };
      });
    }, autoSettleActingMs);
    return () => clearTimeout(t);
  }, [status.phase, status.atMs, autoSettleActingMs]);

  return status;
}

/** Helper for table page: track last WS JSON + last public event. */
export function useAiCognitionFeed() {
  const [lastWsMessage, setLastWsMessage] = useState<unknown>(null);
  const [lastTableEvent, setLastTableEvent] = useState<PublicEventLike | null>(null);

  function onWsMessage(msg: unknown) {
    setLastWsMessage(msg);
    if (msg && typeof msg === "object") {
      const m = msg as Record<string, unknown>;
      if (m.type === "event" && m.event && typeof m.event === "object") {
        const ev = m.event as Record<string, unknown>;
        setLastTableEvent({
          eventType: typeof ev.eventType === "string" ? ev.eventType : undefined,
          payload: (ev.payload as Record<string, unknown>) ?? {},
        });
      }
    }
  }

  return { lastWsMessage, lastTableEvent, onWsMessage };
}
