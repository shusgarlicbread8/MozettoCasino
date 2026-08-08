/**
 * Action EV and profile mixing.
 *
 * Written against a real traced hand where Shark flat-called two pair on the
 * flop and turn with the reason REALIZE_EQUITY, then jammed the river for
 * "VALUE". Both may be right — but the system could not say WHY one line beat
 * another, because it only ever asked whether continuing was profitable.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  estimateResponse,
  evaluateAggressiveEv,
  evaluateCallEv,
  rankByEv,
  tierFor,
} from "./action-ev.js";
import { buildMix, describeMix, sampleMix, PROFILE_STYLE } from "./profile-mix.js";

describe("opponent response distribution", () => {
  const base = { pot: 100, rangeWidthPct: 30, street: "turn" as const };

  it("always sums to one", () => {
    for (const risk of [5, 25, 50, 100, 250]) {
      const r = estimateResponse({ ...base, risk });
      assert.ok(Math.abs(r.fold + r.call + r.raise - 1) < 0.01, `risk ${risk}`);
    }
  });

  it("folds more as the bet grows", () => {
    const small = estimateResponse({ ...base, risk: 5 });
    const big = estimateResponse({ ...base, risk: 150 });
    assert.ok(big.fold > small.fold * 3, "sizing must drive folding");
  });

  it("folds less against a narrow range", () => {
    const wide = estimateResponse({ ...base, risk: 75, rangeWidthPct: 60 });
    const narrow = estimateResponse({ ...base, risk: 75, rangeWidthPct: 8 });
    assert.ok(narrow.fold < wide.fold);
  });

  it("treats a raise's pressure as the increment above the call", () => {
    const bet = estimateResponse({ ...base, risk: 50 });
    const raise = estimateResponse({ ...base, risk: 50, toCall: 40 });
    assert.ok(raise.fold < bet.fold, "only $10 of a $50 raise is fresh pressure");
  });

  it("leans on an observed tendency once there is sample size", () => {
    const stranger = estimateResponse({ ...base, risk: 60, observedFoldTendency: 0.7, handsObserved: 0 });
    const known = estimateResponse({ ...base, risk: 60, observedFoldTendency: 0.7, handsObserved: 400 });
    assert.ok(known.fold > stranger.fold, "a known over-folder should fold more");
  });
});

describe("action EV", () => {
  it("prefers a big value bet when villain's range is inelastic", () => {
    // The traced river: hero has a full house, villain has bet big.
    const response = estimateResponse({ pot: 700, risk: 4800, toCall: 300, rangeWidthPct: 14, street: "river" });
    const jam = evaluateAggressiveEv({
      pot: 700, risk: 4800, toCall: 300, equityWhenCalled: 0.95, response, confidence: 0.5, bb: 100,
    });
    const small = evaluateAggressiveEv({
      pot: 700, risk: 900, toCall: 300,
      equityWhenCalled: 0.95,
      response: estimateResponse({ pot: 700, risk: 900, toCall: 300, rangeWidthPct: 14, street: "river" }),
      confidence: 0.5, bb: 100,
    });
    assert.ok(jam.evChips > small.evChips, "with 95% equity when called, more money in is better");
  });

  it("does not favour jamming when equity when called is poor", () => {
    const response = estimateResponse({ pot: 100, risk: 400, rangeWidthPct: 15, street: "river" });
    const jam = evaluateAggressiveEv({
      pot: 100, risk: 400, equityWhenCalled: 0.12, response, confidence: 0.4, bb: 10,
    });
    assert.ok(jam.evChips < 100, "a bluff jam into a strong range must not beat taking the pot");
  });

  it("values a call by realized equity, not raw equity", () => {
    const good = evaluateCallEv({ pot: 100, toCall: 25, realizedEquity: 0.6, confidence: 0.5, bb: 10 });
    const bad = evaluateCallEv({ pot: 100, toCall: 25, realizedEquity: 0.1, confidence: 0.5, bb: 10 });
    assert.ok(good.evChips > 0);
    assert.ok(bad.evChips < 0);
  });

  it("scales tiers by pot so a big pot does not flatter every line", () => {
    assert.equal(tierFor(80, 100), "BEST");
    assert.equal(tierFor(80, 1000), "MARGINAL");
  });

  it("marks exactly one BEST candidate", () => {
    const ranked = rankByEv([
      { ev: { evChips: 10, evBb: 1, tier: "BEST", response: { fold: 0, call: 1, raise: 0 }, confidence: 0.5, driver: "x" } },
      { ev: { evChips: 40, evBb: 4, tier: "BEST", response: { fold: 0, call: 1, raise: 0 }, confidence: 0.5, driver: "x" } },
      { ev: null },
    ] as never[]);
    const bests = ranked.filter((c: never) => (c as { ev?: { tier: string } }).ev?.tier === "BEST");
    assert.equal(bests.length, 1);
    assert.equal((bests[0] as { ev: { evChips: number } }).ev.evChips, 40);
  });
});

describe("profiles bias close decisions only", () => {
  const close = [
    { action: "call", amountChips: 50, evChips: 100, aggressive: false, viability: "SUPPORTED" as const },
    { action: "raise", amountChips: 200, evChips: 98, aggressive: true, viability: "SUPPORTED" as const },
  ];

  it("all profiles take a clearly best line", () => {
    const clear = [
      { action: "call", amountChips: 50, evChips: 10, aggressive: false, viability: "SUPPORTED" as const },
      { action: "raise", amountChips: 200, evChips: 400, aggressive: true, viability: "SUPPORTED" as const },
    ];
    for (const profile of ["shark", "fox", "professor", "machine"] as const) {
      const mix = buildMix({ candidates: clear, profile, pot: 100 });
      assert.equal(mix.length, 1, `${profile} must not mix a clear decision`);
      assert.equal(mix[0]!.action, "raise");
    }
  });

  it("Shark weights the aggressive branch of a near-tie above Professor", () => {
    const shark = buildMix({ candidates: close, profile: "shark", pot: 100 });
    const professor = buildMix({ candidates: close, profile: "professor", pot: 100 });
    const w = (m: typeof shark) => m.find((c) => c.aggressive)?.weight ?? 0;
    assert.ok(w(shark) > w(professor), "Shark should raise more often in a mix");
    // But Professor must still raise sometimes — style, not incompetence.
    assert.ok(w(professor) > 0.15, "Professor should not abandon aggression");
  });

  it("every profile keeps both options live in a genuine mix", () => {
    for (const profile of ["shark", "fox", "professor", "machine"] as const) {
      const mix = buildMix({ candidates: close, profile, pot: 100 });
      assert.equal(mix.length, 2, profile);
      for (const c of mix) assert.ok(c.weight > 0.05 && c.weight < 0.95, `${profile} ${c.action}`);
    }
  });

  it("weights always sum to one", () => {
    for (const profile of ["shark", "fox", "professor", "machine"] as const) {
      const mix = buildMix({ candidates: close, profile, pot: 100 });
      const total = mix.reduce((n, c) => n + c.weight, 0);
      assert.ok(Math.abs(total - 1) < 0.01, profile);
    }
  });

  it("never mixes an UNSUPPORTED line when a supported one exists", () => {
    const mix = buildMix({
      candidates: [
        { action: "call", amountChips: 50, evChips: 100, aggressive: false, viability: "SUPPORTED" },
        { action: "raise", amountChips: 900, evChips: 99, aggressive: true, viability: "UNSUPPORTED" },
      ],
      profile: "shark",
      pot: 100,
    });
    assert.ok(!mix.some((c) => c.viability === "UNSUPPORTED"));
  });

  it("Fox leans harder on aggression when the read is confident", () => {
    const low = buildMix({ candidates: close, profile: "fox", pot: 100, readConfidence: 0.1 });
    const high = buildMix({ candidates: close, profile: "fox", pot: 100, readConfidence: 0.95 });
    const w = (m: typeof low) => m.find((c) => c.aggressive)?.weight ?? 0;
    assert.ok(w(high) > w(low), "exploit-led profile should use a strong read");
  });

  it("sampling is reproducible and respects weights", () => {
    const mix = buildMix({ candidates: close, profile: "shark", pot: 100 });
    let aggressive = 0;
    const N = 4000;
    let seed = 12345;
    const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 0x100000000);
    for (let i = 0; i < N; i++) {
      if (sampleMix(mix, rand)!.aggressive) aggressive++;
    }
    const observed = aggressive / N;
    const expected = mix.find((c) => c.aggressive)!.weight;
    assert.ok(Math.abs(observed - expected) < 0.04, `sampled ${observed} vs weight ${expected}`);
  });

  it("describes a mixture readably", () => {
    const mix = buildMix({ candidates: close, profile: "shark", pot: 100 });
    assert.match(describeMix(mix), /\d+%/);
  });

  it("keeps all four profiles distinct", () => {
    const keys = Object.keys(PROFILE_STYLE) as Array<keyof typeof PROFILE_STYLE>;
    const sigs = keys.map((k) => JSON.stringify(PROFILE_STYLE[k]));
    assert.equal(new Set(sigs).size, keys.length, "profiles must not be clones");
  });
});
