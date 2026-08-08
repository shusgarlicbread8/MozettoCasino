// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {GameRegistryV2} from "../src/GameRegistryV2.sol";

/// @title CityTemplates — Season 1 per-city GameTemplateV2 bodies
///
/// @notice A city IS its blind level. Stakes are a property of the table, never of a
///         player's bankroll, so each city gets its own sealed template and the 40–100BB
///         buy-in band falls out of the big blind. ArenaVaultV2 reads that band back on
///         every lock, which is what stops a whale buying a deeper stack than the room.
///
/// @dev Template id naming (frozen for Season 1):
///
///        NLHE_HU_<CITY>_V1       heads-up,  maxSeats 2
///        NLHE_SIXMAX_<CITY>_V1   six-max,   maxSeats 6
///
///      `<CITY>` is the UPPERCASED city id — the same value persisted as
///      `tables.league_id` and carried on the seat ticket — not the display name:
///
///        CASUAL (Porto)  BRONZE (Berlin)   SILVER (London)
///        GOLD (Singapore)  PLATINUM (Dubai)  DIAMOND (Monaco)
///
///      The legacy `NLHE_HU_STANDARD_V2` / `NLHE_SIXMAX_STANDARD_V2` ids stay registered:
///      canonical protocol vectors and the WP-106 golden path embed them.
library CityTemplates {
    bytes32 internal constant FAMILY_NLHE = keccak256("NLHE");

    /// @dev Season 1 band, in big blinds. Mirrors GameRegistryV2.MIN/MAX_BUY_IN_BB and
    ///      `packages/game-rules/src/cities.ts`.
    uint256 internal constant MIN_BUY_IN_BB = 40;
    uint256 internal constant MAX_BUY_IN_BB = 100;

    /// @dev Smallest indivisible chip, in USDC atoms ($0.01).
    uint256 internal constant CHIP_UNIT_ATOMS = 10_000;

    /// @dev Plan 11 §Season 1: no rake when the hand ends before a flop.
    bool internal constant NO_FLOP_NO_DROP = true;

    bytes32 internal constant ENGINE_HASH = keccak256("mozetto-nlhe-engine-rc1");
    bytes32 internal constant RULES_HASH = keccak256("nlhe-rules-v2");
    bytes32 internal constant RANDOMNESS_POLICY_ID = keccak256("randomness-policy-v2");
    bytes32 internal constant SETTLEMENT_POLICY_ID = keccak256("settlement-policy-v3");
    bytes32 internal constant MODEL_POLICY_HASH = keccak256("model-policy-groq");
    bytes32 internal constant ENERGY_POLICY_HASH = keccak256("energy-policy-v1");

    uint32 internal constant ACTION_DEADLINE_MS = 15_000;
    uint64 internal constant EMERGENCY_EXIT_DELAY_SEC = 7 days;

    struct City {
        bytes32 huTemplateId;
        bytes32 sixMaxTemplateId;
        uint256 smallBlind;
        uint256 bigBlind;
        uint32 leagueBit;
        /// @dev Porto is unranked: same custody path, no Arena Rating.
        bool ranked;
        /// @dev Provisional Plan 11 schedule, mirrored from `arenaRakeForLeague`.
        uint16 rakeBps;
        uint32 rakeCapMilliBB;
    }

    /// @notice The Season 1 ladder, cheapest first.
    function cities() internal pure returns (City[] memory list) {
        list = new City[](6);
        list[0] = City({
            huTemplateId: keccak256("NLHE_HU_CASUAL_V1"),
            sixMaxTemplateId: keccak256("NLHE_SIXMAX_CASUAL_V1"),
            smallBlind: 0.25e6,
            bigBlind: 0.5e6,
            leagueBit: 16,
            ranked: false,
            rakeBps: 250,
            rakeCapMilliBB: 1_500
        });
        list[1] = City({
            huTemplateId: keccak256("NLHE_HU_BRONZE_V1"),
            sixMaxTemplateId: keccak256("NLHE_SIXMAX_BRONZE_V1"),
            smallBlind: 0.5e6,
            bigBlind: 1e6,
            leagueBit: 1,
            ranked: true,
            rakeBps: 300,
            rakeCapMilliBB: 2_000
        });
        list[2] = City({
            huTemplateId: keccak256("NLHE_HU_SILVER_V1"),
            sixMaxTemplateId: keccak256("NLHE_SIXMAX_SILVER_V1"),
            smallBlind: 1e6,
            bigBlind: 2e6,
            leagueBit: 2,
            ranked: true,
            rakeBps: 275,
            rakeCapMilliBB: 2_000
        });
        list[3] = City({
            huTemplateId: keccak256("NLHE_HU_GOLD_V1"),
            sixMaxTemplateId: keccak256("NLHE_SIXMAX_GOLD_V1"),
            smallBlind: 2.5e6,
            bigBlind: 5e6,
            leagueBit: 4,
            ranked: true,
            rakeBps: 250,
            rakeCapMilliBB: 1_500
        });
        list[4] = City({
            huTemplateId: keccak256("NLHE_HU_PLATINUM_V1"),
            sixMaxTemplateId: keccak256("NLHE_SIXMAX_PLATINUM_V1"),
            smallBlind: 5e6,
            bigBlind: 10e6,
            leagueBit: 8,
            ranked: true,
            rakeBps: 225,
            rakeCapMilliBB: 1_250
        });
        list[5] = City({
            huTemplateId: keccak256("NLHE_HU_DIAMOND_V1"),
            sixMaxTemplateId: keccak256("NLHE_SIXMAX_DIAMOND_V1"),
            smallBlind: 25e6,
            bigBlind: 50e6,
            leagueBit: 32,
            ranked: true,
            rakeBps: 200,
            rakeCapMilliBB: 1_000
        });
    }

    /// @notice Commitment to the rake schedule a city's template is sealed with.
    /// @dev `keccak256(abi.encode(rakeBps, rakeCapMilliBB, noFlopNoDrop, chipUnitAtoms))`.
    ///      The cap is carried in milli-big-blinds so it stays a pure multiple of the
    ///      city's blind rather than a dollar figure that drifts with the stake.
    function rakePolicyHash(uint16 rakeBps, uint32 rakeCapMilliBB) internal pure returns (bytes32) {
        return keccak256(abi.encode(rakeBps, rakeCapMilliBB, NO_FLOP_NO_DROP, CHIP_UNIT_ATOMS));
    }

    function huTemplate(City memory city) internal pure returns (GameRegistryV2.GameTemplateV2 memory) {
        return _body(city, city.huTemplateId, 2, 2);
    }

    function sixMaxTemplate(City memory city) internal pure returns (GameRegistryV2.GameTemplateV2 memory) {
        return _body(city, city.sixMaxTemplateId, 6, 2);
    }

    /// @notice Legacy fixed-id template, kept active for canonical vectors and WP-106.
    /// @dev Berlin stakes, corrected to the Season 1 band.
    function standardTemplate(bytes32 templateId, uint8 maxSeats)
        internal
        pure
        returns (GameRegistryV2.GameTemplateV2 memory)
    {
        City memory berlin = cities()[1];
        return _body(berlin, templateId, maxSeats, 2);
    }

    function _body(City memory city, bytes32 templateId, uint8 maxSeats, uint8 minSeatsToStart)
        private
        pure
        returns (GameRegistryV2.GameTemplateV2 memory)
    {
        return GameRegistryV2.GameTemplateV2({
            templateId: templateId,
            protocolVersion: 3,
            gameFamilyId: FAMILY_NLHE,
            maxSeats: maxSeats,
            minSeatsToStart: minSeatsToStart,
            smallBlind: city.smallBlind,
            bigBlind: city.bigBlind,
            minBuyIn: MIN_BUY_IN_BB * city.bigBlind,
            maxBuyIn: MAX_BUY_IN_BB * city.bigBlind,
            // WP-109: GameTemplate.engineHash → Rust canonical core (event vectors keep draft).
            engineHash: ENGINE_HASH,
            rulesHash: RULES_HASH,
            randomnessPolicyId: RANDOMNESS_POLICY_ID,
            settlementPolicyId: SETTLEMENT_POLICY_ID,
            modelPolicyHash: MODEL_POLICY_HASH,
            energyPolicyHash: ENERGY_POLICY_HASH,
            rakePolicyHash: rakePolicyHash(city.rakeBps, city.rakeCapMilliBB),
            actionDeadlineMs: ACTION_DEADLINE_MS,
            emergencyExitDelaySec: EMERGENCY_EXIT_DELAY_SEC,
            ranked: city.ranked,
            aiOnly: true,
            leagueBit: city.leagueBit
        });
    }
}
