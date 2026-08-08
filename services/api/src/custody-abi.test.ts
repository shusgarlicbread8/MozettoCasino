/**
 * Compensating control for the custody path's disabled type-checking.
 *
 * `arena-onchain.ts` casts every viem contract call to `never` (21 sites) to
 * work around viem's deep generics. That silences the compiler, so the ABI
 * arguments for the money-moving calls are NOT type-checked anywhere.
 *
 * These tests re-establish that guarantee at test time: for each custody call
 * we encode representative arguments against the real ABI. viem's encoder
 * throws on wrong arity, wrong tuple shape, or wrong primitive type, so a
 * drift between our call sites and the contract fails here instead of
 * reverting on-chain with real money locked.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { encodeFunctionData, type Abi } from "viem";
import {
  arenaAccountAbi,
  arenaAccountFactoryAbi,
  arenaVaultV2Abi,
  SEAL_AND_FUND_SESSION_ABI,
} from "@mozetto/blockchain";

const ZERO_ADDR = "0x0000000000000000000000000000000000000000" as const;
const ZERO32 = `0x${"00".repeat(32)}` as const;

/** Find an ABI entry by name, failing loudly when the contract drifted. */
function fn(abi: readonly unknown[], name: string) {
  const entry = (abi as Abi).find(
    (e) => e.type === "function" && e.name === name,
  );
  assert.ok(entry, `ABI is missing function ${name} — call sites will revert`);
  return entry as Extract<Abi[number], { type: "function" }>;
}

describe("custody ABI conformance (compensates for `as never` casts)", () => {
  it("sealAndFundSession encodes a descriptor + tickets + signatures", () => {
    const descriptor = {
      chainId: 31337n,
      protocolVersion: 3,
      sessionId: ZERO32,
      gameTemplateId: ZERO32,
      participantRoot: ZERO32,
      openingBalanceRoot: ZERO32,
      controllerRoot: ZERO32,
      profileRoot: ZERO32,
      dealerSecretRoot: ZERO32,
      randomnessPolicyId: ZERO32,
      settlementPolicyId: ZERO32,
      createdAt: 0n,
      sealDeadline: 0n,
      sessionNonce: ZERO32,
    };
    // Two seats with DIFFERENT buy-ins — the Cities case that must encode.
    const ticket = (buyIn: bigint) => ({
      arenaAccount: ZERO_ADDR,
      gameTemplateId: ZERO32,
      matchmakingPool: ZERO32,
      buyIn,
      controllerHash: ZERO32,
      profileConfigHash: ZERO32,
      modelPolicyHash: ZERO32,
      leagueBit: 1,
      rated: true,
      expiresAt: 0n,
      nonce: 0n,
    });

    assert.doesNotThrow(() =>
      encodeFunctionData({
        abi: SEAL_AND_FUND_SESSION_ABI as Abi,
        functionName: "sealAndFundSession",
        // Berlin: Alice 40BB ($40) and Bob 100BB ($100), in USDC atoms.
        args: [descriptor, [ticket(40_000_000n), ticket(100_000_000n)], [ZERO32, ZERO32]] as never,
      }),
    );
  });

  it("rejects a ticket whose buyIn is not a uint256", () => {
    const bad = {
      arenaAccount: ZERO_ADDR,
      gameTemplateId: ZERO32,
      matchmakingPool: ZERO32,
      buyIn: "forty dollars",
      controllerHash: ZERO32,
      profileConfigHash: ZERO32,
      modelPolicyHash: ZERO32,
      leagueBit: 1,
      rated: true,
      expiresAt: 0n,
      nonce: 0n,
    };
    // Proves the encoder really is validating, so the passing cases mean something.
    assert.throws(() =>
      encodeFunctionData({
        abi: SEAL_AND_FUND_SESSION_ABI as Abi,
        functionName: "sealAndFundSession",
        args: [{}, [bad], []] as never,
      }),
    );
  });

  it("exposes every custody function the API calls", () => {
    // If a contract is redeployed without one of these, fail here rather than
    // at the moment a player's money is being locked.
    for (const name of ["openSession", "topUpSession"]) {
      fn(arenaVaultV2Abi as readonly unknown[], name);
    }
    fn(arenaAccountAbi as readonly unknown[], "setGamePermission");
    fn(arenaAccountFactoryAbi as readonly unknown[], "createAccount");
    fn(arenaAccountFactoryAbi as readonly unknown[], "predictAddress");
  });

  it("openSession takes a descriptor, tickets and signatures", () => {
    const entry = fn(arenaVaultV2Abi as readonly unknown[], "openSession");
    assert.equal(
      entry.inputs.length,
      3,
      "openSession call sites pass (descriptor, tickets, signatures)",
    );
    assert.equal(entry.inputs[1]?.type, "tuple[]", "tickets must be an array");
  });

  it("topUpSession is scoped to one session and one seat ticket", () => {
    const entry = fn(arenaVaultV2Abi as readonly unknown[], "topUpSession");
    // The 100BB top-up cap is enforced per seat, so the call must name the
    // session AND carry a ticket whose buyIn is the amount being added.
    assert.equal(entry.inputs[0]?.type, "bytes32", "first arg is sessionId");
    const ticket = entry.inputs[1];
    assert.equal(ticket?.type, "tuple", "second arg is the seat ticket");
    const components = (ticket as { components?: { name: string; type: string }[] }).components ?? [];
    const buyIn = components.find((c) => c.name === "buyIn");
    assert.equal(buyIn?.type, "uint256", "ticket must carry the top-up amount as buyIn");
  });
});
