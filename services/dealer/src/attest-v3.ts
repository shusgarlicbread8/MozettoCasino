/**
 * WP-084 follow-up: FinalSettlementV3 dealer attestation (DEALER role only).
 * V2 `/v1/dealer/attest` remains for Anvil Hub V2 demos.
 */
import {
  AttestorKeyError,
  FINAL_SETTLEMENT_V3_TYPESTRING,
  loadAttestorKey,
  parseFinalSettlementV3FromHttp,
  signFinalSettlementV3,
  type FinalSettlementV3Message,
} from "@mozetto/attestors";
import { keccak256, toBytes, type Hex } from "viem";

export const FINAL_SETTLEMENT_V3_TYPEHASH = keccak256(toBytes(FINAL_SETTLEMENT_V3_TYPESTRING));

export type DealerAttestV3Result = {
  ok: true;
  signature: Hex;
  attestorAddress: string;
  digest: Hex;
  role: "dealer";
  typehash: Hex;
  eip712Version: "3";
};

export type DealerAttestV3Error = {
  ok: false;
  error: string;
  code?: string;
};

/**
 * Sign FinalSettlementV3 with DEALER_ATTESTOR_PRIVATE_KEY via @mozetto/attestors.
 * Never falls back to SETTLEMENT_PRIVATE_KEY or GAME/REPLAY keys.
 */
export async function attestSettlementV3AsDealer(
  body: unknown,
  env: NodeJS.Dict<string | undefined> = process.env,
  opts: { requireConservation?: boolean } = {},
): Promise<DealerAttestV3Result | DealerAttestV3Error> {
  let settlement: FinalSettlementV3Message;
  try {
    settlement = parseFinalSettlementV3FromHttp(body);
  } catch (e) {
    const msg = e instanceof AttestorKeyError ? e.message : "invalid FinalSettlementV3 body";
    const code = e instanceof AttestorKeyError ? e.code : "INVALID_HTTP_BODY";
    return { ok: false, error: msg, code };
  }

  let key;
  try {
    key = loadAttestorKey("dealer", env);
  } catch (e) {
    const msg =
      e instanceof AttestorKeyError
        ? e.message
        : "DEALER_ATTESTOR_PRIVATE_KEY not configured";
    const code = e instanceof AttestorKeyError ? e.code : "MISSING_KEY";
    return { ok: false, error: msg, code };
  }

  try {
    const att = await signFinalSettlementV3(key, settlement, {
      requireConservation: opts.requireConservation,
    });
    return {
      ok: true,
      signature: att.signature,
      attestorAddress: att.address,
      digest: att.digest,
      role: "dealer",
      typehash: FINAL_SETTLEMENT_V3_TYPEHASH,
      eip712Version: "3",
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const code = e instanceof AttestorKeyError ? e.code : "SIGN_FAILED";
    return { ok: false, error: msg, code };
  }
}
