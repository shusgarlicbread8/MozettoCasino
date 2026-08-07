import type { Hex } from "viem";
import { buildFinalSettlementDigest } from "@mozetto/root-builder";
import {
  serializeFinalSettlementV3ForHttp,
  signFinalSettlementV3,
  tryLoadAttestorKey,
  type Attestation,
  type AttestorRole,
  type FinalSettlementV3Message,
} from "@mozetto/attestors";

export type HttpAttestAdapter = (
  settlement: FinalSettlementV3Message,
) => Promise<{ signature: Hex; attestorAddress: string } | null>;

export type CollectV3AttestationsOpts = {
  settlement: FinalSettlementV3Message;
  /** Roles to attempt (default game, replay, dealer). */
  roles?: readonly AttestorRole[];
  /** Prefer local keys via @mozetto/attestors (default true). */
  preferLocalKeys?: boolean;
  /** Optional HTTP adapters keyed by role (remote dealer/replay services). */
  httpAdapters?: Partial<Record<AttestorRole, HttpAttestAdapter>>;
  requireConservation?: boolean;
};

export type CollectedAttestations = {
  attestations: Attestation[];
  signatures: Hex[];
  roles: AttestorRole[];
  digest: Hex;
};

/**
 * Collect FinalSettlementV3 signatures: local role keys first, then HTTP adapters.
 * Never collapses roles onto SETTLEMENT_PRIVATE_KEY (WP-065 / WP-084).
 */
export async function collectV3Attestations(
  opts: CollectV3AttestationsOpts,
): Promise<CollectedAttestations> {
  const roles = opts.roles ?? (["game", "replay", "dealer"] as const);
  const preferLocal = opts.preferLocalKeys !== false;
  const attestations: Attestation[] = [];
  const digest = buildFinalSettlementDigest(opts.settlement, {
    requireConservation: opts.requireConservation,
  }).digest;

  for (const role of roles) {
    if (preferLocal) {
      const key = tryLoadAttestorKey(role);
      if (key) {
        const att = await signFinalSettlementV3(key, opts.settlement, {
          requireConservation: opts.requireConservation,
        });
        attestations.push({
          role: att.role,
          address: att.address,
          signature: att.signature,
          digest: att.digest,
        });
        continue;
      }
    }

    const adapter = opts.httpAdapters?.[role];
    if (adapter) {
      const remote = await adapter(opts.settlement);
      if (remote?.signature) {
        attestations.push({
          role,
          address: remote.attestorAddress as `0x${string}`,
          signature: remote.signature,
          digest,
        });
      }
    }
  }

  return {
    attestations,
    signatures: attestations.map((a) => a.signature),
    roles: attestations.map((a) => a.role),
    digest,
  };
}

/** Default remote paths (WP-084 follow-up native attest-v3 HTTP). */
export const DEALER_ATTEST_V3_PATH = "/v1/dealer/attest-v3";
export const REPLAY_ATTEST_V3_PATH = "/v1/attest-settlement-v3";

/** POST FinalSettlementV3 JSON to a remote attestor HTTP endpoint. */
export function createHttpV3AttestAdapter(
  baseUrl: string,
  path = REPLAY_ATTEST_V3_PATH,
): HttpAttestAdapter {
  return async (settlement) => {
    try {
      const res = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(serializeSettlementForHttp(settlement)),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as {
        ok?: boolean;
        signature?: string;
        attestorAddress?: string;
      };
      if (!body.signature || !body.attestorAddress) return null;
      if (body.ok === false) return null;
      return {
        signature: body.signature as Hex,
        attestorAddress: body.attestorAddress,
      };
    } catch {
      return null;
    }
  };
}

/** JSON-safe bigint → string encoding for HTTP attestors. */
export function serializeSettlementForHttp(s: FinalSettlementV3Message) {
  return serializeFinalSettlementV3ForHttp(s);
}

/**
 * Wire dealer + replay HTTP attest-v3 adapters for the V3 settlement path.
 * Enabled by default (services now speak FinalSettlementV3). Opt out with
 * `SETTLEMENT_V3_HTTP_ATTEST=0`. Local role keys still take precedence when present.
 */
export function defaultV3HttpAdapters(
  env: NodeJS.ProcessEnv = process.env,
): Partial<Record<AttestorRole, HttpAttestAdapter>> {
  const out: Partial<Record<AttestorRole, HttpAttestAdapter>> = {};
  const replayUrl = env.REPLAY_VERIFIER_URL ?? "http://localhost:4004";
  const dealerUrl = env.DEALER_URL ?? "http://localhost:4003";
  const flag = (env.SETTLEMENT_V3_HTTP_ATTEST ?? "1").toLowerCase();
  if (flag === "0" || flag === "false" || flag === "off") {
    return out;
  }
  out.replay = createHttpV3AttestAdapter(replayUrl, REPLAY_ATTEST_V3_PATH);
  out.dealer = createHttpV3AttestAdapter(dealerUrl, DEALER_ATTEST_V3_PATH);
  return out;
}
