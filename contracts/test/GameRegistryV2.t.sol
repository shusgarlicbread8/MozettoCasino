// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {GameRegistryV2} from "../src/GameRegistryV2.sol";

contract GameRegistryV2Test is Test {
    GameRegistryV2 registry;

    address owner = address(this);
    address guardian = address(0x6A1D);
    address stranger = address(0xBAD);

    uint64 constant DELAY = 1 days;

    bytes32 constant FAMILY_NLHE = keccak256("NLHE");
    bytes32 constant ENGINE = keccak256("mozetto-nlhe-engine-v3-draft");
    bytes32 constant RULES = keccak256("nlhe-rules-v2");
    bytes32 constant RAND = keccak256("randomness-policy-v2");
    bytes32 constant SETTLEMENT = keccak256("settlement-policy-v3");
    bytes32 constant MODEL = keccak256("model-policy-groq");
    bytes32 constant ENERGY = keccak256("energy-policy-v1");
    bytes32 constant RAKE = keccak256("rake-policy-v1");

    function setUp() public {
        registry = new GameRegistryV2(owner, guardian, DELAY);
    }

    function _huBody() internal pure returns (GameRegistryV2.GameTemplateV2 memory t) {
        t = GameRegistryV2.GameTemplateV2({
            templateId: keccak256("NLHE_HU_STANDARD_V2"),
            protocolVersion: 3,
            gameFamilyId: FAMILY_NLHE,
            maxSeats: 2,
            minSeatsToStart: 2,
            smallBlind: 0.5e6,
            bigBlind: 1e6,
            minBuyIn: 40e6, // 40BB
            maxBuyIn: 100e6, // 100BB
            engineHash: ENGINE,
            rulesHash: RULES,
            randomnessPolicyId: RAND,
            settlementPolicyId: SETTLEMENT,
            modelPolicyHash: MODEL,
            energyPolicyHash: ENERGY,
            rakePolicyHash: RAKE,
            actionDeadlineMs: 15_000,
            emergencyExitDelaySec: 7 days,
            ranked: true,
            aiOnly: true,
            leagueBit: 1
        });
    }

    function _sixMaxBody() internal pure returns (GameRegistryV2.GameTemplateV2 memory t) {
        t = _huBody();
        t.templateId = keccak256("NLHE_SIXMAX_STANDARD_V2");
        t.maxSeats = 6;
        t.minSeatsToStart = 2;
    }

    function _registerAndActivate(bytes32 templateId, GameRegistryV2.GameTemplateV2 memory body) internal {
        registry.registerTemplate(body);
        registry.scheduleActivation(templateId);
        vm.warp(block.timestamp + DELAY);
        registry.executeActivation(templateId);
    }

    // -------------------------------------------------------------------------
    // Register
    // -------------------------------------------------------------------------

    function test_register_sealsTemplateAndComputesHash() public {
        GameRegistryV2.GameTemplateV2 memory body = _huBody();
        bytes32 expectedHash = registry.hashTemplate(body);

        vm.expectEmit(true, false, false, true);
        emit GameRegistryV2.TemplateRegistered(body.templateId, expectedHash, body);
        registry.registerTemplate(body);

        assertEq(uint8(registry.getStatus(body.templateId)), uint8(GameRegistryV2.TemplateStatus.Registered));
        assertEq(registry.getTemplateHash(body.templateId), expectedHash);
        assertFalse(registry.isActiveForNewSessions(body.templateId));

        GameRegistryV2.GameTemplateV2 memory stored = registry.getTemplate(body.templateId);
        assertEq(stored.templateId, body.templateId);
        assertEq(stored.maxSeats, 2);
        assertEq(stored.actionDeadlineMs, 15_000);
        assertEq(registry.templateCount(), 1);
        assertEq(registry.templateIdAt(0), body.templateId);
    }

    function test_register_rejectsDuplicate() public {
        registry.registerTemplate(_huBody());
        vm.expectRevert(GameRegistryV2.TemplateExists.selector);
        registry.registerTemplate(_huBody());
    }

    function test_register_rejectsUnauthorized() public {
        vm.prank(stranger);
        vm.expectRevert();
        registry.registerTemplate(_huBody());
    }

    function test_register_rejectsInvalidBody() public {
        GameRegistryV2.GameTemplateV2 memory bad = _huBody();
        bad.protocolVersion = 2;
        vm.expectRevert(GameRegistryV2.InvalidTemplate.selector);
        registry.registerTemplate(bad);

        bad = _huBody();
        bad.bigBlind = bad.smallBlind; // not 2x
        vm.expectRevert(GameRegistryV2.InvalidTemplate.selector);
        registry.registerTemplate(bad);

        bad = _huBody();
        bad.templateId = bytes32(0);
        vm.expectRevert(GameRegistryV2.InvalidTemplate.selector);
        registry.registerTemplate(bad);

        bad = _huBody();
        bad.minSeatsToStart = 6;
        bad.maxSeats = 2;
        vm.expectRevert(GameRegistryV2.InvalidTemplate.selector);
        registry.registerTemplate(bad);
    }

    // -------------------------------------------------------------------------
    // Season 1 buy-in band (40–100BB, derived from the template's big blind)
    // -------------------------------------------------------------------------

    function test_register_requiresSeason1BuyInBand() public {
        assertEq(registry.MIN_BUY_IN_BB(), 40);
        assertEq(registry.MAX_BUY_IN_BB(), 100);

        GameRegistryV2.GameTemplateV2 memory bad = _huBody();
        bad.minBuyIn = 39e6;
        vm.expectRevert(GameRegistryV2.InvalidTemplate.selector);
        registry.registerTemplate(bad);

        bad = _huBody();
        bad.minBuyIn = 41e6;
        vm.expectRevert(GameRegistryV2.InvalidTemplate.selector);
        registry.registerTemplate(bad);

        bad = _huBody();
        bad.maxBuyIn = 200e6;
        vm.expectRevert(GameRegistryV2.InvalidTemplate.selector);
        registry.registerTemplate(bad);

        // Blinds move the band with them: Monaco ($25/$50) is 2000–5000 USDC.
        GameRegistryV2.GameTemplateV2 memory monaco = _huBody();
        monaco.templateId = keccak256("NLHE_HU_DIAMOND_V1");
        monaco.smallBlind = 25e6;
        monaco.bigBlind = 50e6;
        monaco.minBuyIn = 2_000e6;
        monaco.maxBuyIn = 5_000e6;
        monaco.leagueBit = 32;
        registry.registerTemplate(monaco);

        (uint256 minBuyIn, uint256 maxBuyIn) = registry.buyInBand(monaco.templateId);
        assertEq(minBuyIn, 2_000e6);
        assertEq(maxBuyIn, 5_000e6);
    }

    function test_buyInBand_unknownTemplateReturnsZero() public view {
        (uint256 minBuyIn, uint256 maxBuyIn) = registry.buyInBand(keccak256("NEVER_REGISTERED"));
        assertEq(minBuyIn, 0);
        assertEq(maxBuyIn, 0);
    }

    function test_register_immutability_cannotOverwrite() public {
        GameRegistryV2.GameTemplateV2 memory body = _huBody();
        bytes32 originalRake = body.rakePolicyHash;
        registry.registerTemplate(body);

        GameRegistryV2.GameTemplateV2 memory mutated = _huBody();
        mutated.rakePolicyHash = keccak256("mutated-rake");
        vm.expectRevert(GameRegistryV2.TemplateExists.selector);
        registry.registerTemplate(mutated);

        assertEq(registry.getTemplate(body.templateId).rakePolicyHash, originalRake);
    }

    function test_hashTemplate_matchesDomainEncoding() public view {
        GameRegistryV2.GameTemplateV2 memory body = _huBody();
        bytes32 manual = keccak256(
            abi.encode(
                keccak256("MOZETTO_GAME_TEMPLATE_V2"),
                body.templateId,
                body.protocolVersion,
                body.gameFamilyId,
                body.maxSeats,
                body.minSeatsToStart,
                body.smallBlind,
                body.bigBlind,
                body.minBuyIn,
                body.maxBuyIn,
                body.engineHash,
                body.rulesHash,
                body.randomnessPolicyId,
                body.settlementPolicyId,
                body.modelPolicyHash,
                body.energyPolicyHash,
                body.rakePolicyHash,
                body.actionDeadlineMs,
                body.emergencyExitDelaySec,
                body.ranked,
                body.aiOnly,
                body.leagueBit
            )
        );
        assertEq(registry.hashTemplate(body), manual);
        assertEq(registry.DOMAIN_GAME_TEMPLATE_V2(), keccak256("MOZETTO_GAME_TEMPLATE_V2"));
        assertEq(registry.NLHE_HU_STANDARD_V2(), keccak256("NLHE_HU_STANDARD_V2"));
        assertEq(registry.NLHE_SIXMAX_STANDARD_V2(), keccak256("NLHE_SIXMAX_STANDARD_V2"));
    }

    // -------------------------------------------------------------------------
    // Activate (timelock)
    // -------------------------------------------------------------------------

    function test_activate_requiresTimelock() public {
        GameRegistryV2.GameTemplateV2 memory body = _huBody();
        registry.registerTemplate(body);

        registry.scheduleActivation(body.templateId);
        (GameRegistryV2.PendingOp op, uint64 eta) = registry.pending(body.templateId);
        assertEq(uint8(op), uint8(GameRegistryV2.PendingOp.Activate));
        assertEq(eta, uint64(block.timestamp) + DELAY);

        vm.expectRevert(abi.encodeWithSelector(GameRegistryV2.TimelockNotReady.selector, eta));
        registry.executeActivation(body.templateId);

        vm.warp(eta);
        registry.executeActivation(body.templateId);

        assertEq(uint8(registry.getStatus(body.templateId)), uint8(GameRegistryV2.TemplateStatus.Active));
        assertTrue(registry.isActiveForNewSessions(body.templateId));
        assertEq(registry.getTemplateRecord(body.templateId).activatedAt, eta);
    }

    function test_activate_rejectsUnauthorizedSchedule() public {
        registry.registerTemplate(_huBody());
        vm.prank(stranger);
        vm.expectRevert();
        registry.scheduleActivation(keccak256("NLHE_HU_STANDARD_V2"));
    }

    function test_activate_anyoneMayExecuteAfterDelay() public {
        GameRegistryV2.GameTemplateV2 memory body = _huBody();
        registry.registerTemplate(body);
        registry.scheduleActivation(body.templateId);
        vm.warp(block.timestamp + DELAY);

        vm.prank(stranger);
        registry.executeActivation(body.templateId);
        assertTrue(registry.isActiveForNewSessions(body.templateId));
    }

    function test_activate_zeroDelayAllowsSameTimestamp() public {
        GameRegistryV2 zeroDelay = new GameRegistryV2(owner, guardian, 0);
        GameRegistryV2.GameTemplateV2 memory body = _huBody();
        zeroDelay.registerTemplate(body);
        zeroDelay.scheduleActivation(body.templateId);
        zeroDelay.executeActivation(body.templateId);
        assertTrue(zeroDelay.isActiveForNewSessions(body.templateId));
    }

    // -------------------------------------------------------------------------
    // Deactivate (timelock) — history remains verifiable
    // -------------------------------------------------------------------------

    function test_deactivate_stopsNewSessions_keepsHash() public {
        GameRegistryV2.GameTemplateV2 memory body = _huBody();
        bytes32 hashBefore = registry.hashTemplate(body);
        _registerAndActivate(body.templateId, body);

        registry.scheduleDeactivation(body.templateId);
        uint64 eta = uint64(block.timestamp) + DELAY;
        vm.expectRevert(abi.encodeWithSelector(GameRegistryV2.TimelockNotReady.selector, eta));
        registry.executeDeactivation(body.templateId);

        vm.warp(eta);
        registry.executeDeactivation(body.templateId);

        assertEq(uint8(registry.getStatus(body.templateId)), uint8(GameRegistryV2.TemplateStatus.Deactivated));
        assertFalse(registry.isActiveForNewSessions(body.templateId));

        // Historical verification: body + hash unchanged and still readable.
        assertEq(registry.getTemplateHash(body.templateId), hashBefore);
        GameRegistryV2.GameTemplateV2 memory stored = registry.getTemplate(body.templateId);
        assertEq(stored.rakePolicyHash, body.rakePolicyHash);
        assertEq(stored.engineHash, body.engineHash);
        assertEq(registry.hashTemplate(stored), hashBefore);
    }

    function test_deactivate_rejectsUnauthorizedSchedule() public {
        GameRegistryV2.GameTemplateV2 memory body = _huBody();
        _registerAndActivate(body.templateId, body);
        vm.prank(stranger);
        vm.expectRevert();
        registry.scheduleDeactivation(body.templateId);
    }

    function test_deactivate_rejectsWhenNotActive() public {
        registry.registerTemplate(_huBody());
        vm.expectRevert(GameRegistryV2.InvalidStatus.selector);
        registry.scheduleDeactivation(keccak256("NLHE_HU_STANDARD_V2"));
    }

    // -------------------------------------------------------------------------
    // Emergency + cancel
    // -------------------------------------------------------------------------

    function test_emergencyDeactivate_guardianImmediate() public {
        GameRegistryV2.GameTemplateV2 memory body = _huBody();
        bytes32 hashBefore = registry.hashTemplate(body);
        _registerAndActivate(body.templateId, body);

        vm.prank(guardian);
        registry.emergencyDeactivate(body.templateId);

        assertFalse(registry.isActiveForNewSessions(body.templateId));
        assertEq(registry.getTemplateHash(body.templateId), hashBefore);
        assertEq(uint8(registry.getStatus(body.templateId)), uint8(GameRegistryV2.TemplateStatus.Deactivated));
    }

    function test_emergencyDeactivate_rejectsStranger() public {
        GameRegistryV2.GameTemplateV2 memory body = _huBody();
        _registerAndActivate(body.templateId, body);
        vm.prank(stranger);
        vm.expectRevert(GameRegistryV2.Unauthorized.selector);
        registry.emergencyDeactivate(body.templateId);
    }

    function test_emergencyDeactivate_fromRegistered() public {
        GameRegistryV2.GameTemplateV2 memory body = _huBody();
        registry.registerTemplate(body);
        registry.scheduleActivation(body.templateId);

        vm.prank(guardian);
        registry.emergencyDeactivate(body.templateId);

        (GameRegistryV2.PendingOp op,) = registry.pending(body.templateId);
        assertEq(uint8(op), uint8(GameRegistryV2.PendingOp.None));
        assertEq(uint8(registry.getStatus(body.templateId)), uint8(GameRegistryV2.TemplateStatus.Deactivated));
    }

    function test_cancelOperation() public {
        GameRegistryV2.GameTemplateV2 memory body = _huBody();
        registry.registerTemplate(body);
        registry.scheduleActivation(body.templateId);
        registry.cancelOperation(body.templateId);

        (GameRegistryV2.PendingOp op,) = registry.pending(body.templateId);
        assertEq(uint8(op), uint8(GameRegistryV2.PendingOp.None));

        vm.expectRevert(GameRegistryV2.NoPendingOperation.selector);
        registry.executeActivation(body.templateId);
    }

    function test_cannotScheduleWhilePending() public {
        GameRegistryV2.GameTemplateV2 memory body = _huBody();
        registry.registerTemplate(body);
        registry.scheduleActivation(body.templateId);
        vm.expectRevert(GameRegistryV2.OperationPending.selector);
        registry.scheduleActivation(body.templateId);
    }

    function test_unknownTemplateViewsRevert() public {
        bytes32 missing = keccak256("missing");
        vm.expectRevert(GameRegistryV2.UnknownTemplate.selector);
        registry.getTemplate(missing);
        vm.expectRevert(GameRegistryV2.UnknownTemplate.selector);
        registry.getTemplateHash(missing);
    }

    function test_season1_bothTemplates() public {
        GameRegistryV2.GameTemplateV2 memory hu = _huBody();
        GameRegistryV2.GameTemplateV2 memory six = _sixMaxBody();
        _registerAndActivate(hu.templateId, hu);
        _registerAndActivate(six.templateId, six);

        assertTrue(registry.isActiveForNewSessions(hu.templateId));
        assertTrue(registry.isActiveForNewSessions(six.templateId));
        assertEq(registry.templateCount(), 2);
        assertEq(hu.templateId, registry.NLHE_HU_STANDARD_V2());
        assertEq(six.templateId, registry.NLHE_SIXMAX_STANDARD_V2());
    }
}
