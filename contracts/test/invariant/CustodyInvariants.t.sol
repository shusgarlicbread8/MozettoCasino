// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {MockUSDC} from "../../src/MockUSDC.sol";
import {ArenaAccount} from "../../src/ArenaAccount.sol";
import {ArenaAccountFactory} from "../../src/ArenaAccountFactory.sol";
import {ArenaVaultV2} from "../../src/ArenaVaultV2.sol";
import {ProtocolFeeVault} from "../../src/ProtocolFeeVault.sol";
import {SessionLifecycleV2} from "../../src/SessionLifecycleV2.sol";
import {GameRegistryV2} from "../../src/GameRegistryV2.sol";
import {CustodyHandler} from "./CustodyHandler.sol";

/// @title WP-025 — Independent custody invariant / fuzz suite
/// @notice Tries to break Plan 03 exit gate: fuzz cannot create, destroy, redirect, or over-lock USDC.
/// @dev Handler is the sole fuzz target. Agreed run count documented in docs/WP-025_CONTRACT_INVARIANTS.md.
contract CustodyInvariantsTest is StdInvariant, Test {
    uint256 constant ONE = 1e6;
    uint256 constant NUM_PLAYERS = 4;

    bytes32 constant GAME_PERMISSION_TYPEHASH = keccak256(
        "GamePermission(address account,address sessionSigner,address usdc,address vault,bytes32 gameTemplateId,uint32 leagueMask,uint256 lifetimeCommittedCap,uint256 maxTotalAtRisk,uint256 maxSingleBuyIn,uint64 validUntil,uint16 maxConcurrentGames,bool ratedOnly,uint256 nonce,bool enabled)"
    );

    MockUSDC usdc;
    ArenaAccount implementation;
    ArenaAccountFactory factory;
    ArenaVaultV2 vault;
    ProtocolFeeVault feeVault;
    SessionLifecycleV2 lifecycle;
    GameRegistryV2 registry;
    CustodyHandler handler;

    address treasurySafe = address(0x5AFE);
    address guardian = address(0x6A4D);
    bytes32 templateId = keccak256("NLHE_HU_STANDARD_V2");

    uint256 sessionSignerPk = 0x515510;
    address sessionSigner;

    uint256[NUM_PLAYERS] ownerPks;
    address[NUM_PLAYERS] owners;
    address[NUM_PLAYERS] accounts;

    function setUp() public {
        sessionSigner = vm.addr(sessionSignerPk);
        ownerPks[0] = 0xA11CE0;
        ownerPks[1] = 0xB0B000;
        ownerPks[2] = 0xC0C000;
        ownerPks[3] = 0xD0D000;

        usdc = new MockUSDC(address(this));
        implementation = new ArenaAccount();
        factory = new ArenaAccountFactory(address(implementation), address(this));

        feeVault = new ProtocolFeeVault(address(usdc), treasurySafe, address(this), guardian, 0);
        vault = new ArenaVaultV2(address(usdc), address(factory), address(feeVault), address(this));
        feeVault.setDepositor(address(vault), true);

        registry = new GameRegistryV2(address(this), guardian, 0);
        _registerAndActivateTemplate();

        lifecycle = new SessionLifecycleV2(address(this));
        lifecycle.setVault(address(vault));
        lifecycle.setSessionRelayer(address(this));
        lifecycle.setGameRegistry(address(registry));

        vault.setGameRegistry(address(registry));
        vault.setSessionLifecycle(address(lifecycle));

        for (uint256 i = 0; i < NUM_PLAYERS; i++) {
            owners[i] = vm.addr(ownerPks[i]);
            accounts[i] = factory.createAccount(owners[i]);
            usdc.mint(accounts[i], 10_000 * ONE);
            _enablePermission(accounts[i], ownerPks[i]);
        }

        handler = new CustodyHandler(
            usdc,
            factory,
            vault,
            feeVault,
            lifecycle,
            registry,
            address(this),
            treasurySafe,
            templateId,
            sessionSignerPk,
            ownerPks,
            owners,
            accounts
        );

        // Handler acts as compromised relayer + settlement submitter (Plan 03 threat model).
        vault.setSettlementHub(address(handler));
        vault.setSessionRelayer(address(handler));
        lifecycle.setSessionRelayer(address(handler));

        // Mint authority for fundAccount — handler needs MINTER_ROLE.
        usdc.grantRole(usdc.MINTER_ROLE(), address(handler));

        targetContract(address(handler));

        bytes4[] memory selectors = new bytes4[](11);
        selectors[0] = handler.fundAccount.selector;
        selectors[1] = handler.openV2Session.selector;
        selectors[2] = handler.sealV3Session.selector;
        selectors[3] = handler.settleSession.selector;
        selectors[4] = handler.withdrawProtocolFees.selector;
        selectors[5] = handler.sweepFeeVault.selector;
        selectors[6] = handler.tryBadSettleDestination.selector;
        selectors[7] = handler.tryTopUpSealed.selector;
        selectors[8] = handler.tryOverCapBuyIn.selector;
        selectors[9] = handler.tryPostSealDraftMutation.selector;
        selectors[10] = handler.ownerWithdrawIdle.selector;
        // warpAhead omitted from weight — time warps via fund/open paths are enough; keep optional
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    // =========================================================================
    // Invariants (Plan 03 § Vault accounting / Security tests)
    // =========================================================================

    /// @notice Core solvency: session locks + accrued rake never exceed USDC held by vault.
    /// @dev With no external donations to the vault, equality holds (Plan 03 preferred form).
    function invariant_vaultLiabilitiesCoveredByUsdc() public view {
        uint256 liabilities = handler.vaultLiabilities();
        uint256 held = usdc.balanceOf(address(vault));
        assertLe(liabilities, held, "vault underfunded vs liabilities");
        assertEq(liabilities, held, "vault USDC != locks + accrued fees (donation/leak)");
    }

    /// @notice ProtocolFeeVault accrued fees never exceed its USDC balance.
    function invariant_feeVaultAccruedLeBalance() public view {
        assertLe(feeVault.accruedFees(), usdc.balanceOf(address(feeVault)), "fee vault underfunded");
    }

    /// @notice Fee vault holds only recognized fees (accrued == balance; no stray principal).
    function invariant_feeVaultNoStrayPrincipal() public view {
        assertEq(feeVault.accruedFees(), usdc.balanceOf(address(feeVault)), "fee vault stray USDC");
    }

    /// @notice Active sessions: every locked player is a factory ArenaAccount; fee vault never a participant.
    function invariant_lockedPlayersAreArenaAccounts() public view {
        uint256 n = handler.activeSessionCount();
        for (uint256 i = 0; i < n; i++) {
            bytes32 sid = handler.activeSessions(i);
            address[] memory parts = handler.participantsOf(sid);
            for (uint256 j = 0; j < parts.length; j++) {
                address p = parts[j];
                assertTrue(factory.ownerOf(p) != address(0), "locked player not ArenaAccount");
                assertTrue(p != address(feeVault), "fee vault listed as participant");
                assertTrue(p != treasurySafe, "treasury listed as participant");
                assertTrue(vault.sessionParticipants(sid, p), "ghost participant missing on vault");
                assertGt(vault.lockedBySession(sid, p), 0, "tracked participant has zero lock");
            }
            assertEq(vault.sessionParticipantCount(sid), handler.ghostParticipantCount(sid), "participant count drift");
        }
    }

    /// @notice V3 sealed sessions: participant count and lifecycle participantRoot immutable.
    function invariant_noPostSealParticipantChange() public view {
        uint256 n = handler.activeSessionCount();
        for (uint256 i = 0; i < n; i++) {
            bytes32 sid = handler.activeSessions(i);
            if (!handler.isV3(sid)) continue;

            assertTrue(vault.sessionSealedV3(sid), "V3 ghost not sealed on vault");
            assertEq(
                vault.sessionParticipantCount(sid),
                handler.ghostParticipantCount(sid),
                "post-seal participant count changed"
            );

            SessionLifecycleV2.SessionRecord memory rec = lifecycle.getSession(sid);
            if (rec.state != SessionLifecycleV2.State.None) {
                assertEq(rec.participantRoot, handler.ghostParticipantRoot(sid), "lifecycle participantRoot mutated");
                assertTrue(
                    uint8(rec.state) >= uint8(SessionLifecycleV2.State.Sealed),
                    "lifecycle not at least SEALED for V3"
                );
                assertTrue(rec.state != SessionLifecycleV2.State.Draft, "lifecycle regressed to DRAFT");
            }
        }
    }

    /// @notice GamePermission caps: at-risk / lifetime / concurrent never exceed authorized maxima.
    function invariant_permissionCapsRespected() public view {
        for (uint256 i = 0; i < NUM_PLAYERS; i++) {
            (
                ,
                ,
                ,
                ,
                ,
                uint256 lifetimeCap,
                uint256 lifetimeCommitted,
                uint256 maxAtRisk,
                uint256 activeAtRisk,
                uint256 maxSingle,
                ,
                uint16 maxConcurrent,
                uint16 activeGames,
                ,
                bool enabled
            ) = ArenaAccount(accounts[i]).gameAuth();

            // Caps apply whenever exposure is non-zero even after revoke clears authority fields
            // (lifetimeCommitted / activeAtRisk are preserved on revoke).
            if (enabled) {
                assertLe(lifetimeCommitted, lifetimeCap, "lifetime cap exceeded");
                assertLe(activeAtRisk, maxAtRisk, "at-risk cap exceeded");
                assertLe(uint256(activeGames), uint256(maxConcurrent), "concurrent games exceeded");
                assertGt(maxSingle, 0, "enabled permission missing maxSingle");
            }

            // Vault totalLocked must match ArenaAccount activeAtRisk (exposure accounting).
            assertEq(vault.totalLocked(accounts[i]), activeAtRisk, "vault lock != account activeAtRisk");
        }
    }

    /// @notice Adversarial handler paths must never succeed (redirect / over-lock / post-seal mutate).
    function invariant_adversarialPathsNeverSucceed() public view {
        assertFalse(handler.ghostBrokenBadSettle(), "settle redirected to non-ArenaAccount");
        assertFalse(handler.ghostBrokenTopUpSealed(), "post-seal top-up mutated participants");
        assertFalse(handler.ghostBrokenOverCap(), "over-cap buy-in locked");
        assertFalse(handler.ghostBrokenPostSealMutation(), "post-seal draft mutation");
    }

    /// @notice Settled sessions leave zero locks for tracked participants; unsettled keep conservation.
    function invariant_sessionLocksConsistent() public view {
        uint256 n = handler.activeSessionCount();
        for (uint256 i = 0; i < n; i++) {
            bytes32 sid = handler.activeSessions(i);
            (,,,,, uint64 openedAt, bool settled,,,) = vault.sessions(sid);
            assertGt(openedAt, 0, "active ghost missing session");
            assertFalse(settled, "settled session still in active ghost list");

            address[] memory parts = handler.participantsOf(sid);
            uint256 sum;
            for (uint256 j = 0; j < parts.length; j++) {
                sum += vault.lockedBySession(sid, parts[j]);
            }
            assertGt(sum, 0, "active session with zero aggregate lock");
            assertEq(parts.length, vault.sessionParticipantCount(sid), "participant array vs count");
        }
    }

    // =========================================================================
    // Setup helpers
    // =========================================================================

    function _registerAndActivateTemplate() internal {
        GameRegistryV2.GameTemplateV2 memory body = GameRegistryV2.GameTemplateV2({
            templateId: templateId,
            protocolVersion: 3,
            gameFamilyId: keccak256("NLHE"),
            maxSeats: 2,
            minSeatsToStart: 2,
            smallBlind: 1 * ONE,
            bigBlind: 2 * ONE,
            minBuyIn: ONE,
            maxBuyIn: 1_000 * ONE,
            engineHash: keccak256("engine"),
            rulesHash: keccak256("rules"),
            randomnessPolicyId: keccak256("rand"),
            settlementPolicyId: keccak256("settle"),
            modelPolicyHash: keccak256("model"),
            energyPolicyHash: keccak256("energy"),
            rakePolicyHash: keccak256("rake"),
            actionDeadlineMs: 15_000,
            emergencyExitDelaySec: 7 days,
            ranked: true,
            aiOnly: true,
            leagueBit: 1
        });
        registry.registerTemplate(body);
        registry.scheduleActivation(templateId);
        registry.executeActivation(templateId);
    }

    function _enablePermission(address account, uint256 ownerPk) internal {
        uint256 nonce = ArenaAccount(account).gameAuthNonce();
        uint64 validUntil = uint64(block.timestamp + 365 days);
        uint256 lifetimeCap = 50_000 * ONE;
        uint256 maxAtRisk = 2_000 * ONE;
        uint256 maxSingle = 500 * ONE;
        uint16 maxConcurrent = 3;

        bytes32 structHash = keccak256(
            abi.encode(
                GAME_PERMISSION_TYPEHASH,
                account,
                sessionSigner,
                address(usdc),
                address(vault),
                templateId,
                uint32(1),
                lifetimeCap,
                maxAtRisk,
                maxSingle,
                validUntil,
                maxConcurrent,
                false,
                nonce,
                true
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", _accountDomain(account), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerPk, digest);
        ArenaAccount(account).setGamePermission(
            sessionSigner,
            address(usdc),
            address(vault),
            templateId,
            1,
            lifetimeCap,
            maxAtRisk,
            maxSingle,
            validUntil,
            maxConcurrent,
            false,
            nonce,
            true,
            abi.encodePacked(r, s, v)
        );
    }

    function _accountDomain(address account) internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("MozettoArenaAccount")),
                keccak256(bytes("1")),
                block.chainid,
                account
            )
        );
    }
}
