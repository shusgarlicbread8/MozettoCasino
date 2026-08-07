import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  allocateRankedMatch,
  assertRankedParticipantIntegrity,
  evaluateOpponentIntegrity,
  filterEligibleCandidates,
  isPairAtCap,
  matchesRankedPool,
  MAX_PAIR_MATCHES_PER_DAY,
  PAIR_REDUCED_WEIGHT_UNTIL,
  pairRatingWeight,
  pickRandomEligible,
  rankedPoolKey,
  randomSeatOrder,
  StubLinkedAccountStore,
  type MatchCandidate,
  type PoolConstraints,
  type TablePoolFields,
} from "./matchmaking.js";

function seqRandom(values: number[]): () => number {
  let i = 0;
  return () => {
    const v = values[i] ?? 0;
    i += 1;
    return v;
  };
}

describe("ranked pool constraints (WP-040)", () => {
  const pool: PoolConstraints = {
    leagueId: "gold",
    buyIn: 1500,
    maxSeats: 2,
    variantId: "nlhe_hu",
    arenaMode: "demo",
    chainId: null,
  };

  const base: TablePoolFields = {
    leagueId: "gold",
    minBuyIn: 1500,
    maxSeats: 2,
    variantId: "nlhe_hu",
    arenaMode: "demo",
    chainId: null,
    privacy: "public",
    isActive: true,
    emptySeats: 1,
  };

  it("accepts same-pool public active table with empty seat", () => {
    assert.equal(matchesRankedPool(base, pool), true);
  });

  it("rejects different league / buy-in / variant / mode", () => {
    assert.equal(matchesRankedPool({ ...base, leagueId: "silver" }, pool), false);
    assert.equal(matchesRankedPool({ ...base, minBuyIn: 500 }, pool), false);
    assert.equal(matchesRankedPool({ ...base, variantId: "nlhe_6max", maxSeats: 6 }, pool), false);
    assert.equal(matchesRankedPool({ ...base, arenaMode: "onchain", chainId: 84532 }, pool), false);
  });

  it("rejects private, inactive, or full tables", () => {
    assert.equal(matchesRankedPool({ ...base, privacy: "private" }, pool), false);
    assert.equal(matchesRankedPool({ ...base, isActive: false }, pool), false);
    assert.equal(matchesRankedPool({ ...base, emptySeats: 0 }, pool), false);
  });

  it("on-chain pool requires matching chainId", () => {
    const onchainPool: PoolConstraints = {
      ...pool,
      arenaMode: "onchain",
      chainId: 84532,
    };
    assert.equal(
      matchesRankedPool(
        { ...base, arenaMode: "onchain", chainId: 84532 },
        onchainPool,
      ),
      true,
    );
    assert.equal(
      matchesRankedPool(
        { ...base, arenaMode: "onchain", chainId: 8453 },
        onchainPool,
      ),
      false,
    );
  });

  it("rankedPoolKey encodes mode/format/league/buy-in without room id", () => {
    const key = rankedPoolKey({
      leagueId: "bronze",
      format: "hu",
      arenaMode: "demo",
      chainId: null,
      buyIn: 100,
    });
    assert.match(key, /^ranked:demo:demo:hu:bronze:buyin=100$/);
    assert.equal(key.includes("arena_"), false);
  });
});

describe("pair caps (WP-040 / WP-043 / Plan 12)", () => {
  it("caps at MAX_PAIR_MATCHES_PER_DAY", () => {
    assert.equal(isPairAtCap(0), false);
    assert.equal(isPairAtCap(MAX_PAIR_MATCHES_PER_DAY - 1), false);
    assert.equal(isPairAtCap(MAX_PAIR_MATCHES_PER_DAY), true);
    assert.equal(isPairAtCap(MAX_PAIR_MATCHES_PER_DAY + 2), true);
  });

  it("pairRatingWeight matches Plan 12 bands", () => {
    assert.equal(pairRatingWeight(0), 1);
    assert.equal(pairRatingWeight(MAX_PAIR_MATCHES_PER_DAY - 1), 1);
    assert.equal(pairRatingWeight(MAX_PAIR_MATCHES_PER_DAY), 0.5);
    assert.equal(pairRatingWeight(PAIR_REDUCED_WEIGHT_UNTIL - 1), 0.5);
    assert.equal(pairRatingWeight(PAIR_REDUCED_WEIGHT_UNTIL), 0);
  });

  it("HU filter excludes self and pair-capped opponents", () => {
    const candidates: MatchCandidate[] = [
      { id: "t1", name: "A", seated: 1, owners: ["me"] },
      { id: "t2", name: "B", seated: 1, owners: ["capped"] },
      { id: "t3", name: "C", seated: 1, owners: ["ok"] },
    ];
    const { eligible, rejects } = filterEligibleCandidates({
      userId: "me",
      format: "hu",
      candidates,
      pairCapped: (opp) => opp === "capped",
    });
    assert.deepEqual(
      eligible.map((e) => e.id),
      ["t3"],
    );
    assert.equal(rejects.some((r) => r.reason === "self_seated" && r.tableId === "t1"), true);
    assert.equal(rejects.some((r) => r.reason === "pair_capped" && r.tableId === "t2"), true);
  });

  it("Classic does not apply HU pair caps", () => {
    const candidates: MatchCandidate[] = [
      { id: "t1", name: "A", seated: 2, owners: ["a", "b"] },
    ];
    const { eligible, rejects } = filterEligibleCandidates({
      userId: "me",
      format: "classic",
      candidates,
      pairCapped: () => true,
    });
    assert.equal(eligible.length, 1);
    assert.equal(rejects.length, 0);
  });
});

describe("anti-pairing identity hooks (WP-043)", () => {
  it("evaluateOpponentIntegrity blocks self, linked, then pair-cap", () => {
    assert.equal(
      evaluateOpponentIntegrity({
        userId: "me",
        opponentId: "me",
        format: "hu",
        pairCapped: () => false,
      }).ok,
      false,
    );
    const linked = evaluateOpponentIntegrity({
      userId: "me",
      opponentId: "alt",
      format: "hu",
      pairCapped: () => true,
      linkedToUser: (id) => id === "alt",
    });
    assert.equal(linked.ok, false);
    if (!linked.ok) assert.equal(linked.reason, "linked_account");

    const capped = evaluateOpponentIntegrity({
      userId: "me",
      opponentId: "rival",
      format: "hu",
      pairCapped: () => true,
      linkedToUser: () => false,
    });
    assert.equal(capped.ok, false);
    if (!capped.ok) assert.equal(capped.reason, "pair_capped");
  });

  it("HU and Classic exclude linked accounts", () => {
    const candidates: MatchCandidate[] = [
      { id: "t-linked", name: "L", seated: 1, owners: ["alt"] },
      { id: "t-ok", name: "O", seated: 1, owners: ["stranger"] },
      { id: "t-self", name: "S", seated: 1, owners: ["me"] },
    ];
    for (const format of ["hu", "classic"] as const) {
      const { eligible, rejects } = filterEligibleCandidates({
        userId: "me",
        format,
        candidates,
        pairCapped: () => false,
        linkedToUser: (opp) => opp === "alt",
      });
      assert.deepEqual(
        eligible.map((e) => e.id),
        ["t-ok"],
        format,
      );
      assert.equal(
        rejects.some((r) => r.reason === "linked_account" && r.tableId === "t-linked"),
        true,
        format,
      );
      assert.equal(
        rejects.some((r) => r.reason === "self_seated" && r.tableId === "t-self"),
        true,
        format,
      );
    }
  });

  it("Classic still blocks same beneficial owner on multi-seat table", () => {
    const { eligible, rejects } = filterEligibleCandidates({
      userId: "me",
      format: "classic",
      candidates: [{ id: "t1", name: "X", seated: 2, owners: ["me", "other"] }],
      pairCapped: () => false,
    });
    assert.equal(eligible.length, 0);
    assert.equal(rejects[0]?.reason, "self_seated");
  });

  it("StubLinkedAccountStore is symmetric and feeds allocator", () => {
    const store = new StubLinkedAccountStore([["alice", "alice-alt"]]);
    assert.equal(store.getExcludedPeers("alice").has("alice-alt"), true);
    assert.equal(store.getExcludedPeers("alice-alt").has("alice"), true);

    const decision = allocateRankedMatch({
      userId: "alice",
      format: "hu",
      maxSeats: 2,
      candidates: [
        { id: "t1", name: "linked", seated: 1, owners: ["alice-alt"] },
        { id: "t2", name: "ok", seated: 1, owners: ["bob"] },
      ],
      pairCapped: () => false,
      linkedToUser: (opp) => store.getExcludedPeers("alice").has(opp),
      random: () => 0,
    });
    assert.equal(decision.kind, "join_existing");
    if (decision.kind === "join_existing") {
      assert.equal(decision.candidate.id, "t2");
      assert.equal(decision.rejects[0]?.reason, "linked_account");
    }
  });

  it("assertRankedParticipantIntegrity rejects duplicates and linked pairs", () => {
    const store = new StubLinkedAccountStore([["a", "a2"]]);
    assert.throws(
      () =>
        assertRankedParticipantIntegrity({
          ownerIds: ["a", "a"],
          linkedPeersOf: (id) => store.getExcludedPeers(id),
        }),
      /self_match/,
    );
    assert.throws(
      () =>
        assertRankedParticipantIntegrity({
          ownerIds: ["a", "a2"],
          linkedPeersOf: (id) => store.getExcludedPeers(id),
        }),
      /linked_account/,
    );
    assert.doesNotThrow(() =>
      assertRankedParticipantIntegrity({
        ownerIds: ["a", "b"],
        linkedPeersOf: (id) => store.getExcludedPeers(id),
      }),
    );
  });

  it("allocate creates table when only linked opponents remain", () => {
    const decision = allocateRankedMatch({
      userId: "me",
      format: "classic",
      maxSeats: 6,
      candidates: [{ id: "t1", name: "X", seated: 1, owners: ["alt"] }],
      pairCapped: () => false,
      linkedToUser: () => true,
      random: () => 0,
    });
    assert.equal(decision.kind, "create_table");
    assert.equal(decision.rejects[0]?.reason, "linked_account");
  });
});

describe("random allocation (WP-040)", () => {
  it("pickRandomEligible is uniform over indices for seeded RNG", () => {
    assert.equal(pickRandomEligible(["a", "b", "c"], () => 0), "a");
    assert.equal(pickRandomEligible(["a", "b", "c"], () => 0.34), "b");
    assert.equal(pickRandomEligible(["a", "b", "c"], () => 0.99), "c");
    assert.equal(pickRandomEligible([], () => 0), undefined);
  });

  it("allocateRankedMatch joins randomly among eligible — not fullest-first", () => {
    const candidates: MatchCandidate[] = [
      { id: "fuller", name: "F", seated: 1, owners: ["x"] },
      { id: "emptier", name: "E", seated: 0, owners: [] },
    ];
    // First random() for seat shuffle (2 seats → one swap draw), then pick index.
    // Force pick of index 1 ("emptier") to prove we do not prefer seated desc.
    const random = seqRandom([0, 0.9]);
    const decision = allocateRankedMatch({
      userId: "me",
      format: "hu",
      maxSeats: 2,
      candidates,
      pairCapped: () => false,
      random,
    });
    assert.equal(decision.kind, "join_existing");
    if (decision.kind === "join_existing") {
      assert.equal(decision.candidate.id, "emptier");
      assert.equal(decision.seatOrder.length, 2);
      assert.deepEqual([...decision.seatOrder].sort((a, b) => a - b), [0, 1]);
    }
  });

  it("Poker Classic fills the fullest eligible table before opening another", () => {
    const decision = allocateRankedMatch({
      userId: "me",
      format: "classic",
      maxSeats: 6,
      candidates: [
        { id: "one", name: "One", seated: 1, owners: ["a"] },
        { id: "four", name: "Four", seated: 4, owners: ["b", "c", "d", "e"] },
        { id: "two", name: "Two", seated: 2, owners: ["f", "g"] },
      ],
      pairCapped: () => false,
      random: () => 0.99,
    });
    assert.equal(decision.kind, "join_existing");
    if (decision.kind === "join_existing") {
      assert.equal(decision.candidate.id, "four");
    }
  });

  it("allocateRankedMatch creates table when all candidates rejected", () => {
    const decision = allocateRankedMatch({
      userId: "me",
      format: "hu",
      maxSeats: 2,
      candidates: [{ id: "t1", name: "X", seated: 1, owners: ["rival"] }],
      pairCapped: () => true,
      random: () => 0,
    });
    assert.equal(decision.kind, "create_table");
    if (decision.kind === "create_table") {
      assert.equal(decision.rejects[0]?.reason, "pair_capped");
    }
  });

  it("randomSeatOrder is a permutation", () => {
    const order = randomSeatOrder(6, seqRandom([0.1, 0.2, 0.3, 0.4, 0.5]));
    assert.equal(order.length, 6);
    assert.deepEqual([...order].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5]);
  });
});
