import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ALL_LEAGUE_MASK, cityTemplateId, leagueBit } from "@mozetto/blockchain";
import { CITIES } from "@mozetto/game-rules";

/**
 * The on-chain league bit is keyed by the same id the lobby calls a `cityId`
 * and the database calls `league_id`. A city with no bit cannot be played
 * on-chain at all: `ArenaAccount.lockBuyIn` reverts `LeagueNotAllowed()` when
 * the ticket's bit is 0, so a gap here is a silent outage for that city.
 */
describe("every city has an on-chain league bit", () => {
  it("assigns a distinct power-of-two bit per city", () => {
    const seen = new Map<number, string>();
    for (const city of CITIES) {
      const bit = leagueBit(city.id);
      assert.ok(bit > 0, `${city.name} (${city.id}) has no league bit`);
      assert.equal(bit & (bit - 1), 0, `${city.name} bit ${bit} is not a power of two`);
      assert.equal(seen.has(bit), false, `${city.name} reuses ${seen.get(bit)}'s bit ${bit}`);
      seen.set(bit, city.name);
    }
  });

  it("includes every city in the seamless-play permission mask", () => {
    for (const city of CITIES) {
      const bit = leagueBit(city.id);
      assert.equal(ALL_LEAGUE_MASK & bit, bit, `${city.name} missing from ALL_LEAGUE_MASK`);
    }
  });

  it("keeps Monaco playable — the diamond bit regression", () => {
    assert.ok(leagueBit("diamond") > 0);
    assert.equal(ALL_LEAGUE_MASK & leagueBit("diamond"), leagueBit("diamond"));
  });
});

/**
 * A seat ticket naming a template the registry never activated cannot be
 * sealed, so the ids computed here must be byte-identical to the ones
 * `contracts/script/CityTemplates.sol` registers. The digests are written out
 * rather than recomputed: a formula checked against itself would agree happily
 * while disagreeing with the chain.
 */
describe("city template ids match the registered Season 1 templates", () => {
  const HU_TEMPLATE_IDS: Record<string, string> = {
    casual: "0xfa3c1281a28457e4f8c8603faefbdd51fd5b9e1ee55cb56341575aef9a6e8467",
    bronze: "0xd0da008de51a21f1b7fba9a551e13f99e9e1d187b22df61e940b81039b172c4c",
    silver: "0xb99a93bd37ae2ddce58c36677ddad383143084bca8163c9a4a06480682f1d707",
    gold: "0xe08117d2448b34fb15db991ebda922ae352bd2b67c5c3759aa4b3ffb145c72dc",
    platinum: "0x0eb6b291d4ab3c60300df485769929e820fdfdd96228d6f3359def79a378caf7",
    diamond: "0x766f1142acb851170536562c731fbb18e115610c892468ff989cf0679da0683a",
  };

  it("pins the heads-up id for every city on the ladder", () => {
    for (const city of CITIES) {
      const expected = HU_TEMPLATE_IDS[city.id];
      assert.ok(expected, `${city.name} (${city.id}) has no pinned template id`);
      assert.equal(cityTemplateId(city.id), expected, city.name);
    }
  });

  it("names the id after the city id, not the display name", () => {
    assert.notEqual(cityTemplateId("diamond"), cityTemplateId("monaco"));
    assert.equal(cityTemplateId("DIAMOND"), cityTemplateId("diamond"));
  });

  it("separates heads-up from six-max", () => {
    assert.notEqual(cityTemplateId("bronze", "hu"), cityTemplateId("bronze", "sixmax"));
  });
});
