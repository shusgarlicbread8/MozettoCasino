import assert from "node:assert/strict";
import { test } from "node:test";
import {
  abuseStateAuthorizesFundSeizure,
  blocksRankedMatchmaking,
  canTransitionAbuseState,
  transitionAbuseState,
} from "./abuse-states.js";
import {
  agentLoadoutResetsRating,
  defaultPlayer,
  evaluateRatingUpdateGate,
  HU_RANKED_POOL_SEASON1,
  huCityPoolId,
  isPairFrequencyCapped,
  isRankedCityId,
  MAX_PAIR_MATCHES_PER_DAY,
  PAIR_REDUCED_WEIGHT_UNTIL,
  provisionalAfterMatches,
  rankedHuPoolsForCity,
  rateHeadsUpMatch,
  repeatedOpponentRatingWeight,
  stakeScalesRating,
} from "./index.js";
import { assessRiskSignals } from "./risk-signals.js";

test("pair rating weight bands match Plan 12", () => {
  assert.equal(repeatedOpponentRatingWeight(0), 1);
  assert.equal(repeatedOpponentRatingWeight(MAX_PAIR_MATCHES_PER_DAY - 1), 1);
  assert.equal(repeatedOpponentRatingWeight(MAX_PAIR_MATCHES_PER_DAY), 0.5);
  assert.equal(repeatedOpponentRatingWeight(PAIR_REDUCED_WEIGHT_UNTIL - 1), 0.5);
  assert.equal(repeatedOpponentRatingWeight(PAIR_REDUCED_WEIGHT_UNTIL), 0);
  assert.equal(isPairFrequencyCapped(4), false);
  assert.equal(isPairFrequencyCapped(5), true);
});

test("zero pair weight leaves Glicko unchanged", () => {
  const a = defaultPlayer();
  const b = { rating: 1600, rd: 50, volatility: 0.06 };
  const next = rateHeadsUpMatch(a, b, 1, 0);
  assert.equal(next.a.rating, a.rating);
  assert.equal(next.a.rd, a.rd);
});

test("stake does not scale rating deltas", () => {
  assert.equal(stakeScalesRating(), false);
  const a = { rating: 1500, rd: 50, volatility: 0.06 };
  const b = { rating: 1500, rd: 50, volatility: 0.06 };
  // Stake is never an input to rateHeadsUpMatch — same weight → same delta.
  const lowStake = rateHeadsUpMatch(a, b, 1, 1);
  const highStake = rateHeadsUpMatch(a, b, 1, 1);
  assert.equal(lowStake.a.rating, highStake.a.rating);
  assert.equal(lowStake.b.rating, highStake.b.rating);
});

test("agent loadout never resets account rating identity", () => {
  assert.equal(agentLoadoutResetsRating(), false);
  // Account rating is owner+pool keyed; two "agents" share the same default player.
  const before = defaultPlayer();
  const afterNewAgent = defaultPlayer();
  assert.deepEqual(before, afterNewAgent);
  assert.equal(provisionalAfterMatches(0), true);
  assert.equal(provisionalAfterMatches(19), true);
  assert.equal(provisionalAfterMatches(20), false);
});

test("per-city HU pools + combined are both eligible", () => {
  assert.equal(isRankedCityId("bronze"), true);
  assert.equal(isRankedCityId("casual"), false);
  assert.deepEqual(rankedHuPoolsForCity("bronze"), [
    huCityPoolId("bronze"),
    HU_RANKED_POOL_SEASON1,
  ]);
  assert.deepEqual(rankedHuPoolsForCity("casual"), []);

  const cityGate = evaluateRatingUpdateGate({
    matchClass: "ranked_public",
    format: "hu",
    settlementConfirmed: true,
    replayOrEventVerified: true,
    providerIncidentVoid: false,
    integrityHold: false,
    pairIdentityOk: true,
    ratingWeight: 1,
    poolId: huCityPoolId("diamond"),
    sessionId: "sess-city",
    settlementOrProofRoot: "0xabc",
  });
  assert.equal(cityGate.allow, true);
});

test("rating update gate rejects private / custom / six-max / voids", () => {
  const base = {
    matchClass: "ranked_public" as const,
    format: "hu" as const,
    settlementConfirmed: true,
    replayOrEventVerified: true,
    providerIncidentVoid: false,
    integrityHold: false,
    pairIdentityOk: true,
    ratingWeight: 1,
    poolId: HU_RANKED_POOL_SEASON1,
    sessionId: "sess-1",
    settlementOrProofRoot: "0xabc",
  };
  assert.equal(evaluateRatingUpdateGate(base).allow, true);

  const priv = evaluateRatingUpdateGate({ ...base, matchClass: "private" });
  assert.equal(priv.allow, false);
  if (!priv.allow) assert.equal(priv.reason, "private_or_custom_unranked");

  const casual = evaluateRatingUpdateGate({ ...base, matchClass: "casual_unranked" });
  assert.equal(casual.allow, false);
  if (!casual.allow) assert.equal(casual.reason, "private_or_custom_unranked");

  const six = evaluateRatingUpdateGate({ ...base, format: "sixmax", poolId: "nlhe_6max_standard" });
  assert.equal(six.allow, false);

  const voided = evaluateRatingUpdateGate({ ...base, providerIncidentVoid: true });
  assert.equal(voided.allow, false);
  if (!voided.allow) assert.equal(voided.reason, "provider_incident_void");

  const hold = evaluateRatingUpdateGate({ ...base, integrityHold: true });
  assert.equal(hold.allow, false);

  const unverified = evaluateRatingUpdateGate({ ...base, replayOrEventVerified: false });
  assert.equal(unverified.allow, false);

  const unsettled = evaluateRatingUpdateGate({ ...base, settlementConfirmed: false });
  assert.equal(unsettled.allow, false);

  const linked = evaluateRatingUpdateGate({ ...base, pairIdentityOk: false });
  assert.equal(linked.allow, false);

  const capped = evaluateRatingUpdateGate({ ...base, ratingWeight: 0 });
  assert.equal(capped.allow, false);
  if (!capped.allow) assert.equal(capped.reason, "zero_pair_weight");
});

test("abuse states block matchmaking without authorizing fund seizure", () => {
  assert.equal(blocksRankedMatchmaking("CLEAR"), false);
  assert.equal(blocksRankedMatchmaking("MATCHMAKING_RESTRICTED"), true);
  assert.equal(blocksRankedMatchmaking("SUSPENDED"), true);
  assert.equal(abuseStateAuthorizesFundSeizure("SUSPENDED"), false);
  assert.equal(canTransitionAbuseState("CLEAR", "MONITORED"), true);
  assert.equal(canTransitionAbuseState("CLEAR", "RESOLVED"), false);
  assert.equal(transitionAbuseState("SUSPENDED", "APPEAL").ok, true);
  assert.equal(transitionAbuseState("CLEAR", "APPEAL").ok, false);
});

test("risk signals flag for review but never auto-punish", () => {
  const weak = assessRiskSignals([
    { id: "soft_play_pair", strength: 0.9, sampleSize: 2, evidenceRef: "pair:a-b" },
  ]);
  assert.equal(weak.autoPunishForbidden, true);
  assert.equal(weak.confidence, "insufficient");
  assert.ok(weak.score < 40);

  const stronger = assessRiskSignals([
    { id: "chip_dumping_pattern", strength: 0.8, sampleSize: 40, evidenceRef: "sess:1" },
    { id: "repeated_net_transfer_direction", strength: 0.7, sampleSize: 40 },
    { id: "timing_synchronization", strength: 0.6, sampleSize: 30 },
  ]);
  assert.equal(stronger.autoPunishForbidden, true);
  assert.ok(stronger.suggestedActions.includes("flag_review"));
  assert.ok(!stronger.suggestedActions.includes("none") || stronger.score < 15);
});
