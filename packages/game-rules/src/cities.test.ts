import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buyInBand,
  CITIES,
  cityDisplay,
  cityIdAlias,
  cityMode,
  cityModeLabel,
  MAX_BUY_IN_BB,
  MIN_BUY_IN_BB,
  minimumReentryAtoms,
  RAT_HOLE_COOLDOWN_MS,
  requireCity,
  requireCityId,
  resolveCityId,
  validateBuyIn,
} from "./cities.js";
import {
  ATOMS_PER_USDC,
  CHIP_UNIT_ATOMS,
  assertChipAligned,
  atomsToChips,
  atomsToUsdc,
  checkConservation,
  formatUsdc,
  isChipAligned,
  usdcToAtoms,
} from "./money.js";

describe("canonical money", () => {
  it("round-trips whole dollars through atoms", () => {
    assert.equal(usdcToAtoms(1), 1_000_000n);
    assert.equal(usdcToAtoms(0.5), 500_000n);
    assert.equal(usdcToAtoms(0.01), 10_000n);
    assert.equal(atomsToUsdc(2_500_000n), 2.5);
  });

  it("treats a chip as $0.01", () => {
    assert.equal(CHIP_UNIT_ATOMS, 10_000n);
    assert.equal(ATOMS_PER_USDC / CHIP_UNIT_ATOMS, 100n);
    assert.equal(atomsToChips(usdcToAtoms(1.5)), 150n);
  });

  it("rejects sub-chip dust rather than silently rounding it", () => {
    assert.equal(isChipAligned(1_500n), false);
    assert.throws(() => assertChipAligned(1_500n, "bet"), /whole number of \$0\.01 chips/);
    assert.throws(() => atomsToChips(1_500n));
  });

  it("formats atoms as dollars and cents", () => {
    assert.equal(formatUsdc(1_000_000n), "$1.00");
    assert.equal(formatUsdc(250_000n), "$0.25");
    assert.equal(formatUsdc(123_450_000n), "$123.45");
    assert.equal(formatUsdc(-500_000n), "-$0.50");
  });

  it("detects broken chip conservation", () => {
    assert.equal(checkConservation({ wagered: 100, paidOut: 95, rake: 5 }).ok, true);
    const broken = checkConservation({ wagered: 100, paidOut: 120, rake: 0 });
    assert.equal(broken.ok, false);
    assert.equal(broken.drift, 20n);
  });
});

describe("cities define stakes; bankroll does not", () => {
  it("every city has chip-aligned blinds with sb = bb / 2", () => {
    for (const c of CITIES) {
      assert.ok(isChipAligned(c.smallBlindAtoms), `${c.id} sb off-grid`);
      assert.ok(isChipAligned(c.bigBlindAtoms), `${c.id} bb off-grid`);
      assert.equal(c.bigBlindAtoms, c.smallBlindAtoms * 2n, `${c.id} sb should be half bb`);
    }
  });

  it("derives a 40-100BB band from the blind level", () => {
    for (const c of CITIES) {
      const band = buyInBand(c);
      assert.equal(band.minAtoms, c.bigBlindAtoms * BigInt(MIN_BUY_IN_BB));
      assert.equal(band.maxAtoms, c.bigBlindAtoms * BigInt(MAX_BUY_IN_BB));
    }
  });

  it("caps a whale at the table maximum regardless of bankroll", () => {
    const berlin = requireCity("bronze"); // $0.50 / $1
    const result = validateBuyIn({
      city: berlin,
      requestedAtoms: usdcToAtoms(250_000),
      availableAtoms: usdcToAtoms(1_000_000),
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "above_maximum");
    assert.match(result.message!, /bankroll does not raise this cap/);
    // The ceiling is 100BB = $100, not a function of the $1,000,000 wallet.
    assert.equal(buyInBand(berlin).maxAtoms, usdcToAtoms(100));
  });

  it("lets a modest bankroll buy in for the same maximum as a whale", () => {
    const berlin = requireCity("bronze");
    const modest = validateBuyIn({
      city: berlin,
      requestedAtoms: usdcToAtoms(100),
      availableAtoms: usdcToAtoms(140),
    });
    assert.equal(modest.ok, true);
    assert.equal(modest.bb, 100);
  });

  it("enforces the 40BB floor", () => {
    const london = requireCity("silver"); // $1 / $2 → $80–$200
    const tooShort = validateBuyIn({ city: london, requestedAtoms: usdcToAtoms(79) });
    assert.equal(tooShort.ok, false);
    assert.equal(tooShort.reason, "below_minimum");
    const atFloor = validateBuyIn({ city: london, requestedAtoms: usdcToAtoms(80) });
    assert.equal(atFloor.ok, true);
    assert.equal(atFloor.bb, 40);
  });

  it("rejects sub-chip buy-ins", () => {
    const london = requireCity("silver");
    const dust = validateBuyIn({ city: london, requestedAtoms: 100_000_500n });
    assert.equal(dust.ok, false);
    assert.equal(dust.reason, "not_chip_aligned");
  });

  it("treats bankroll as a reducer only, never an amplifier", () => {
    const london = requireCity("silver");
    const broke = validateBuyIn({
      city: london,
      requestedAtoms: usdcToAtoms(200),
      availableAtoms: usdcToAtoms(90),
    });
    assert.equal(broke.ok, false);
    assert.equal(broke.reason, "insufficient_balance");
  });

  it("exposes a lobby view with explicit stakes and band", () => {
    const d = cityDisplay(requireCity("silver"));
    assert.equal(d.stakesLabel, "$1.00 / $2.00");
    assert.equal(d.buyInLabel, "$80.00 – $200.00");
    assert.equal(d.buyInBbLabel, "40 – 100 BB");
    // A card built from this view can never be just a city name.
    assert.equal(d.variantLabel, "NLHE");
    assert.equal(d.modeLabel, "Ranked");
  });

  it("keeps stakes and skill as independent axes", () => {
    // No city carries a rating gate — economics must not imply ability.
    for (const c of CITIES) {
      assert.equal("minRating" in c, false, `${c.id} must not gate on rating`);
    }
  });
});

describe("Casual is a mode, not a price bracket", () => {
  it("makes Porto the only Casual city and Berlin the first Ranked one", () => {
    assert.equal(cityMode("casual"), "casual");
    assert.equal(requireCity("casual").name, "Porto");
    for (const c of CITIES) {
      const expected = c.id === "casual" ? "casual" : "ranked";
      assert.equal(cityMode(c.id), expected, `${c.name} mode`);
    }
    assert.equal(cityMode("bronze"), "ranked");
    assert.equal(cityMode("diamond"), "ranked");
  });

  it('says "Casual" — never "Practice" or "Unranked" — in user-facing copy', () => {
    assert.equal(cityModeLabel("casual"), "Casual");
    assert.equal(cityModeLabel("bronze"), "Ranked");
    const porto = requireCity("casual");
    assert.match(porto.tagline, /Casual/);
    assert.doesNotMatch(porto.tagline, /practice/i);
    assert.doesNotMatch(porto.tagline, /unranked/i);
  });

  it("never implies that the cheapest city is Casual because it is cheap", () => {
    // Porto is Casual on purpose; the price ladder is a separate axis, so no
    // city's flavour text may argue from stakes to rating.
    for (const c of CITIES) {
      assert.doesNotMatch(c.tagline, /cheap|budget|low stakes/i, `${c.name} tagline`);
    }
    // If it were about price, Porto would not be the only unrated city.
    const unrated = CITIES.filter((c) => !c.rated).map((c) => c.id);
    assert.deepEqual(unrated, ["casual"]);
  });
});

describe("league_id ≡ cityId", () => {
  it("accepts either spelling and normalises case", () => {
    assert.equal(resolveCityId({ cityId: "casual" }), "casual");
    assert.equal(resolveCityId({ leagueId: "casual" }), "casual");
    assert.equal(resolveCityId({ leagueId: " Bronze " }), "bronze");
    assert.equal(resolveCityId("DIAMOND"), "diamond");
  });

  it("prefers cityId when a caller sends both", () => {
    assert.equal(resolveCityId({ cityId: "gold", leagueId: "bronze" }), "gold");
  });

  it("returns null rather than guessing when neither is present", () => {
    assert.equal(resolveCityId({}), null);
    assert.equal(resolveCityId({ leagueId: "" }), null);
    assert.equal(resolveCityId(null), null);
  });

  it("requireCityId rejects a missing or unknown city", () => {
    assert.equal(requireCityId({ leagueId: "silver" }), "silver");
    assert.throws(() => requireCityId({}), /required/);
    assert.throws(() => requireCityId({ cityId: "atlantis" }), /unknown city/);
  });

  it("echoes both names so either reader is satisfied", () => {
    assert.deepEqual(cityIdAlias("platinum"), { cityId: "platinum", leagueId: "platinum" });
    const d = cityDisplay(requireCity("platinum"));
    assert.equal(d.cityId, d.leagueId);
    assert.equal(d.cityId, d.id);
  });
});

describe("anti rat-holing", () => {
  const city = requireCity("silver"); // $80–$200

  it("makes a quick re-entrant return with what they left", () => {
    assert.equal(
      minimumReentryAtoms({
        city,
        lastLeavingStackAtoms: usdcToAtoms(180),
        msSinceLeaving: 60_000,
      }),
      usdcToAtoms(180),
    );
  });

  it("never demands more than the table maximum", () => {
    assert.equal(
      minimumReentryAtoms({
        city,
        lastLeavingStackAtoms: usdcToAtoms(5_000),
        msSinceLeaving: 1_000,
      }),
      buyInBand(city).maxAtoms,
    );
  });

  it("returns to the normal floor once the cooldown expires", () => {
    assert.equal(
      minimumReentryAtoms({
        city,
        lastLeavingStackAtoms: usdcToAtoms(180),
        msSinceLeaving: RAT_HOLE_COOLDOWN_MS + 1,
      }),
      buyInBand(city).minAtoms,
    );
  });

  it("does not penalize someone who left short", () => {
    assert.equal(
      minimumReentryAtoms({
        city,
        lastLeavingStackAtoms: usdcToAtoms(60),
        msSinceLeaving: 1_000,
      }),
      buyInBand(city).minAtoms,
    );
  });

  it("has no floor for a first-time entrant", () => {
    assert.equal(
      minimumReentryAtoms({ city, lastLeavingStackAtoms: null, msSinceLeaving: null }),
      buyInBand(city).minAtoms,
    );
  });
});
