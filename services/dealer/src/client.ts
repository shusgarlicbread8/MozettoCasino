import { createHash } from "node:crypto";
import { commitSeed } from "@mozetto/game-rules";

const DEFAULT_DEALER_URL = "http://localhost:4003";

export type HandSeedParams = {
  sessionId: string;
  handNumber: number;
  vrfWord: string;
  secretIndex: number;
};

export type HandSeedResult = {
  handSeed: string;
  seedCommit: string;
  dealerRoot?: string;
};

/** Publish deck seed commit (sha256) — same as engine commit-reveal. */
export function commitDeckSeed(handSeed: string): string {
  return commitSeed(handSeed);
}

/** Deterministic fallback when dealer service is unreachable. */
export function fallbackHandSeed(params: HandSeedParams): string {
  return createHash("sha256")
    .update(`mozetto-poker-v1:${params.sessionId}:${params.handNumber}:${params.vrfWord}:${params.secretIndex}`)
    .digest("hex");
}

export async function fetchHandSeed(
  params: HandSeedParams,
  dealerUrl = process.env.DEALER_URL ?? DEFAULT_DEALER_URL,
): Promise<HandSeedResult | null> {
  try {
    const res = await fetch(`${dealerUrl.replace(/\/$/, "")}/v1/dealer/hand-seed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { handSeed?: string; dealerRoot?: string };
    if (!body.handSeed) return null;
    return {
      handSeed: body.handSeed,
      seedCommit: commitDeckSeed(body.handSeed),
      dealerRoot: body.dealerRoot,
    };
  } catch {
    return null;
  }
}

export type DealerAttestRequest = {
  sessionId: string;
  finalSequence: number;
  eventRoot: string;
  handRoot: string;
  balanceRoot: string;
  totalRake: string;
  deadline: number;
};

export async function requestDealerAttestation(
  payload: DealerAttestRequest,
  dealerUrl = process.env.DEALER_URL ?? DEFAULT_DEALER_URL,
): Promise<{ signature: string; attestorAddress: string } | null> {
  try {
    const res = await fetch(`${dealerUrl.replace(/\/$/, "")}/v1/dealer/attest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { signature?: string; attestorAddress?: string };
    if (!body.signature || !body.attestorAddress) return null;
    return { signature: body.signature, attestorAddress: body.attestorAddress };
  } catch {
    return null;
  }
}
