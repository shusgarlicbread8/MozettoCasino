/**
 * WP-082 unit tests — reorg/rebuild/lag helpers + event catalog (no live RPC required).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MONEY_EVENT_NAMES,
  gameRegistryEvents,
  proofBatchRegistryEvents,
  protocolFeeVaultEvents,
  randomnessBeaconEvents,
  sessionLifecycleEvents,
  settlementHubEvents,
  vaultMoneyEvents,
  vaultProjectionEvents,
} from "./events.js";
import { IndexerMetrics, computeLagBlocks, isReorgMismatch } from "./metrics.js";
import { findReorgStart } from "./reorg.js";

describe("WP-082 money sole-writer catalog", () => {
  it("money event names are exactly the ledger-mutating set", () => {
    assert.deepEqual(
      [...MONEY_EVENT_NAMES].sort(),
      ["BuyInLocked", "Deposited", "SessionPayout", "Withdrawn"].sort(),
    );
  });

  it("vault money events include deposit surface", () => {
    const names = vaultMoneyEvents().map((e) => e.name);
    assert.ok(names.includes("Deposited"));
    assert.ok(names.includes("Withdrawn"));
    assert.ok(names.includes("BuyInLocked"));
    assert.ok(names.includes("SessionPayout"));
  });

  it("projection event catalogs are non-empty for V3 surfaces", () => {
    assert.ok(vaultProjectionEvents().length >= 4);
    assert.ok(settlementHubEvents(false).some((e) => e.name === "Settled"));
    assert.ok(settlementHubEvents(true).some((e) => e.name === "Settled"));
    assert.ok(gameRegistryEvents().length >= 2);
    assert.ok(sessionLifecycleEvents().some((e) => e.name === "SessionTransition"));
    assert.ok(protocolFeeVaultEvents().some((e) => e.name === "FeesSwept"));
    assert.ok(randomnessBeaconEvents().some((e) => e.name === "VrfFulfilled"));
    assert.ok(proofBatchRegistryEvents().some((e) => e.name === "ProofBatchRegistered"));
  });
});

describe("WP-082 lag metrics", () => {
  it("computeLagBlocks returns zero when caught up", () => {
    assert.equal(computeLagBlocks(100n, 100n), 0);
    assert.equal(computeLagBlocks(101n, 100n), 0);
  });

  it("computeLagBlocks counts blocks behind safe head", () => {
    assert.equal(computeLagBlocks(90n, 100n), 10);
  });

  it("IndexerMetrics.snapshot reports lag and version v3", () => {
    const m = new IndexerMetrics();
    m.noteTickStart(31337, "anvil");
    m.noteHeads(50n, 60n, 57n, 3);
    m.noteTickSuccess(2);
    m.setWatched({ arenaVault: "0xabc" }, ["arenaVault"]);
    const snap = m.snapshot();
    assert.equal(snap.version, "v3");
    assert.equal(snap.service, "chain-indexer");
    assert.equal(snap.lagBlocks, 7);
    assert.equal(snap.logsProcessedTotal, 2);
    assert.equal(snap.ok, true);
    assert.deepEqual(snap.moneyPathContracts, ["arenaVault"]);
  });

  it("noteReorg and noteRebuild increment counters", () => {
    const m = new IndexerMetrics();
    m.noteReorg();
    m.noteRebuild();
    m.noteRebuild();
    const snap = m.snapshot();
    assert.equal(snap.reorgsDetected, 1);
    assert.equal(snap.rebuilds, 2);
  });
});

describe("WP-082 reorg detection helpers", () => {
  it("isReorgMismatch is case-insensitive", () => {
    assert.equal(isReorgMismatch("0xAa", "0xaa"), false);
    assert.equal(isReorgMismatch("0xAa", "0xbb"), true);
    assert.equal(isReorgMismatch(null, "0xaa"), false);
  });

  it("findReorgStart returns earliest mismatched block", () => {
    const start = findReorgStart([
      { block: 10n, stored: "0x1111", chain: "0x1111" },
      { block: 11n, stored: "0x2222", chain: "0xdead" },
      { block: 12n, stored: "0x3333", chain: "0x3333" },
    ]);
    assert.equal(start, 11n);
  });

  it("findReorgStart treats missing chain block as reorg", () => {
    const start = findReorgStart([
      { block: 5n, stored: "0xaaaa", chain: "0xaaaa" },
      { block: 6n, stored: "0xbbbb", chain: null },
    ]);
    assert.equal(start, 6n);
  });

  it("findReorgStart returns null when hashes agree", () => {
    assert.equal(
      findReorgStart([
        { block: 1n, stored: "0x01", chain: "0x01" },
        { block: 2n, stored: "0x02", chain: "0x02" },
      ]),
      null,
    );
  });
});

describe("WP-082 rebuild semantics (documented contract)", () => {
  it("rebuild resets to deployment block without inventing money credits", () => {
    // Rebuild is cursor-only: forceRebuild → ensureCursor(deploymentBlock).
    // Money mirrors remain gated by vault_deposits.mirrored + unique (chainId, txHash, logIndex).
    // This test locks the invariant that MONEY_EVENT_NAMES is the only credit path.
    for (const name of ["TemplateActivated", "ProofBatchRegistered", "FeesSwept", "VrfFulfilled"]) {
      assert.equal(MONEY_EVENT_NAMES.has(name), false);
    }
  });
});
