import type { Hex } from "viem";

/** One check in a verification report. */
export type CheckResult = {
  id: string;
  ok: boolean;
  detail: string;
};

export type VerifyReport = {
  workPacket: "WP-055";
  policyId: "MOZETTO_RANDOMNESS_V2";
  vectorsDir: string;
  ok: boolean;
  passed: number;
  failed: number;
  checks: CheckResult[];
};

/** Public card opening against a committed deckRoot. */
export type CardOpeningInput = {
  handId: Hex;
  deckRoot: Hex;
  position: number;
  cardCode: number;
  cardSalt: Hex;
  proof: { sibling: Hex; isLeft: boolean }[];
};

export type OpeningVerifyResult = {
  ok: boolean;
  cardLeaf: Hex;
  detail: string;
};
