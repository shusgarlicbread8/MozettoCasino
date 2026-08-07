import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  derivePublicVerifyStatus,
  deriveVerifyComponents,
  toLegacyBadge,
} from "./verify-status.js";

const base = {
  sessionStatus: "playing",
  settlementTxHash: null as string | null,
  proposalStatus: null as string | null,
  attestorCount: 0,
  checkpointCount: 0,
  checkpointWithTxCount: 0,
  handRootCount: 0,
  vrfFulfilledCount: 0,
  vrfRequestCount: 0,
  dealerRoot: null as string | null,
  lastEventRoot: null as string | null,
  lastBalanceRoot: null as string | null,
};

describe("WP-090 derivePublicVerifyStatus", () => {
  it("marks incomplete when little public data exists", () => {
    const s = derivePublicVerifyStatus(base);
    assert.equal(s, "INCOMPLETE_PUBLIC_DATA");
    assert.equal(toLegacyBadge(s), "incomplete");
  });

  it("pending base anchor when roots exist without tx", () => {
    const s = derivePublicVerifyStatus({
      ...base,
      checkpointCount: 2,
      lastEventRoot: "0xabc",
    });
    assert.equal(s, "PENDING_BASE_ANCHOR");
  });

  it("pending settlement when proposal in flight", () => {
    const s = derivePublicVerifyStatus({
      ...base,
      sessionStatus: "settling",
      proposalStatus: "attesting",
      attestorCount: 1,
      checkpointCount: 2,
      checkpointWithTxCount: 2,
      lastEventRoot: "0xabc",
    });
    assert.equal(s, "PENDING_SETTLEMENT");
  });

  it("verified with attested private dealer when fully settled", () => {
    const s = derivePublicVerifyStatus({
      ...base,
      sessionStatus: "settled",
      settlementTxHash: "0xtx",
      proposalStatus: "confirmed",
      attestorCount: 2,
      checkpointCount: 3,
      checkpointWithTxCount: 3,
      handRootCount: 2,
      vrfRequestCount: 1,
      vrfFulfilledCount: 1,
      dealerRoot: "0xdealer",
      lastEventRoot: "0xevent",
      lastBalanceRoot: "0xbal",
    });
    assert.equal(s, "VERIFIED_WITH_ATTESTED_PRIVATE_DEALER");
    assert.equal(toLegacyBadge(s), "verified");
    const c = deriveVerifyComponents({
      ...base,
      sessionStatus: "settled",
      settlementTxHash: "0xtx",
      proposalStatus: "confirmed",
      attestorCount: 2,
      checkpointCount: 3,
      checkpointWithTxCount: 3,
      handRootCount: 2,
      vrfRequestCount: 1,
      vrfFulfilledCount: 1,
      dealerRoot: "0xdealer",
      lastEventRoot: "0xevent",
      lastBalanceRoot: "0xbal",
    });
    assert.equal(c.settlement, "ok");
    assert.equal(c.baseAnchor, "ok");
  });

  it("verification_failed when flag set", () => {
    assert.equal(
      derivePublicVerifyStatus({ ...base, verificationFailed: true }),
      "VERIFICATION_FAILED",
    );
  });
});
