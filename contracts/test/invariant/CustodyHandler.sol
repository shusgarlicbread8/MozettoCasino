// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockUSDC} from "../../src/MockUSDC.sol";
import {ArenaAccount} from "../../src/ArenaAccount.sol";
import {ArenaAccountFactory} from "../../src/ArenaAccountFactory.sol";
import {ArenaVaultV2} from "../../src/ArenaVaultV2.sol";
import {ProtocolFeeVault} from "../../src/ProtocolFeeVault.sol";
import {SessionLifecycleV2} from "../../src/SessionLifecycleV2.sol";
import {GameRegistryV2} from "../../src/GameRegistryV2.sol";

/// @notice Bounded fuzz actor for WP-025 custody invariants.
/// @dev Privileged as vault relayer + settlement hub so settle/open stay in-scope.
///      Invalid paths are attempted under try/catch so fail_on_revert=false stays useful.
contract CustodyHandler is Test {
    uint256 public constant NUM_PLAYERS = 4;
    uint256 public constant ONE = 1e6;
    uint8 public constant LEAGUE_MICRO = 1;
    uint32 public constant LEAGUE_MASK = 1;

    bytes32 public constant SEAT_TICKET_TYPEHASH = keccak256(
        "SeatTicket(address player,bytes32 gameTemplateId,uint256 buyIn,bytes32 controllerHash,bytes32 agentProfileHash,uint64 expiresAt,uint256 nonce,bytes32 matchmakingPool,uint32 leagueBit,bool rated)"
    );

    bytes32 public constant SEAT_TICKET_V3_TYPEHASH = keccak256(
        "SeatTicketV3(address arenaAccount,bytes32 gameTemplateId,bytes32 matchmakingPool,uint256 buyIn,bytes32 controllerHash,bytes32 profileConfigHash,bytes32 modelPolicyHash,uint8 leagueBit,bool rated,uint64 expiresAt,uint256 nonce)"
    );

    bytes32 public constant DOMAIN_PARTICIPANT_LEAF_V1 = keccak256("MOZETTO_PARTICIPANT_LEAF_V1");
    bytes32 public constant DOMAIN_OPENING_BALANCE_LEAF_V1 = keccak256("MOZETTO_OPENING_BALANCE_LEAF_V1");
    bytes32 public constant DOMAIN_CONTROLLER_LEAF_V1 = keccak256("MOZETTO_CONTROLLER_LEAF_V1");
    bytes32 public constant DOMAIN_SESSION_ID_V1 = keccak256("MOZETTO_SESSION_ID_V1");

    MockUSDC public immutable usdc;
    ArenaAccountFactory public immutable factory;
    ArenaVaultV2 public immutable vault;
    ProtocolFeeVault public immutable feeVault;
    SessionLifecycleV2 public immutable lifecycle;
    GameRegistryV2 public immutable registry;
    address public immutable testOwner;
    address public immutable treasurySafe;
    bytes32 public immutable templateId;

    uint256 public immutable sessionSignerPk;
    address public immutable sessionSigner;

    uint256[NUM_PLAYERS] public ownerPks;
    address[NUM_PLAYERS] public owners;
    address[NUM_PLAYERS] public accounts;

    // ---- Ghost / bookkeeping ----
    bytes32[] public activeSessions;
    mapping(bytes32 => bool) public isActive;
    mapping(bytes32 => bool) public isV3;
    mapping(bytes32 => uint256) public ghostParticipantCount;
    mapping(bytes32 => bytes32) public ghostParticipantRoot;
    mapping(bytes32 => address[]) internal _participants;

    uint256 public nextTicketNonce = 1;
    uint64 public nextCheckpointSeq = 1;
    uint256 public callsOpenV2;
    uint256 public callsSealV3;
    uint256 public callsSettle;
    uint256 public callsWithdrawFees;
    uint256 public callsSweep;
    uint256 public callsBadSettle;
    uint256 public callsTopUpSealed;
    uint256 public callsOverCap;
    uint256 public callsPostSealMutation;
    uint256 public ghostFeesSwept;
    uint256 public ghostUsdcMintedToAccounts;

    /// @dev Must remain false — set if an adversarial path unexpectedly succeeds.
    bool public ghostBrokenBadSettle;
    bool public ghostBrokenTopUpSealed;
    bool public ghostBrokenOverCap;
    bool public ghostBrokenPostSealMutation;

    constructor(
        MockUSDC usdc_,
        ArenaAccountFactory factory_,
        ArenaVaultV2 vault_,
        ProtocolFeeVault feeVault_,
        SessionLifecycleV2 lifecycle_,
        GameRegistryV2 registry_,
        address testOwner_,
        address treasurySafe_,
        bytes32 templateId_,
        uint256 sessionSignerPk_,
        uint256[NUM_PLAYERS] memory ownerPks_,
        address[NUM_PLAYERS] memory owners_,
        address[NUM_PLAYERS] memory accounts_
    ) {
        usdc = usdc_;
        factory = factory_;
        vault = vault_;
        feeVault = feeVault_;
        lifecycle = lifecycle_;
        registry = registry_;
        testOwner = testOwner_;
        treasurySafe = treasurySafe_;
        templateId = templateId_;
        sessionSignerPk = sessionSignerPk_;
        sessionSigner = vm.addr(sessionSignerPk_);
        ownerPks = ownerPks_;
        owners = owners_;
        accounts = accounts_;
    }

    function activeSessionCount() external view returns (uint256) {
        return activeSessions.length;
    }

    function participantsOf(bytes32 sid) external view returns (address[] memory) {
        return _participants[sid];
    }

    // -------------------------------------------------------------------------
    // Bounded actions
    // -------------------------------------------------------------------------

    /// @notice Mint USDC into a player ArenaAccount (external funding; never mints into vault).
    function fundAccount(uint256 playerSeed, uint256 amountSeed) external {
        uint256 i = playerSeed % NUM_PLAYERS;
        uint256 amount = bound(amountSeed, ONE, 2_000 * ONE);
        usdc.mint(accounts[i], amount);
        ghostUsdcMintedToAccounts += amount;
    }

    /// @notice Open a V2 HU session (mutable epoch; top-up still allowed).
    function openV2Session(uint256 seed, uint256 buyInSeed) external {
        (uint256 a, uint256 b) = _twoPlayers(seed);
        uint256 buyIn = bound(buyInSeed, ONE, 200 * ONE);
        if (!_canLock(accounts[a], buyIn) || !_canLock(accounts[b], buyIn)) return;

        bytes32 sid = keccak256(abi.encodePacked("v2", seed, nextTicketNonce, block.timestamp));
        if (isActive[sid]) return;

        ArenaVaultV2.SeatTicket[] memory tickets = new ArenaVaultV2.SeatTicket[](2);
        bytes[] memory sigs = new bytes[](2);
        tickets[0] = _v2Ticket(accounts[a], buyIn, nextTicketNonce++);
        tickets[1] = _v2Ticket(accounts[b], buyIn, nextTicketNonce++);
        sigs[0] = _signV2(tickets[0]);
        sigs[1] = _signV2(tickets[1]);

        try vault.openSession(
            ArenaVaultV2.SessionConfig({
                sessionId: sid,
                gameTemplateId: templateId,
                dealerRoot: bytes32(0),
                engineHash: bytes32(0),
                profileSetHash: bytes32(0),
                emergencyExitDelay: 7 days
            }),
            tickets,
            sigs
        ) {
            _trackSession(sid, false, bytes32(0), tickets[0].player, tickets[1].player);
            callsOpenV2++;
        } catch {}
    }

    /// @notice Atomic V3 seal-and-fund (immutable participants for the epoch).
    function sealV3Session(uint256 seed, uint256 buyInSeed) external {
        (uint256 a, uint256 b) = _twoPlayers(seed);
        uint256 buyIn = bound(buyInSeed, ONE, 200 * ONE);
        if (!_canLock(accounts[a], buyIn) || !_canLock(accounts[b], buyIn)) return;

        ArenaVaultV2.SeatTicketV3[] memory tickets = new ArenaVaultV2.SeatTicketV3[](2);
        tickets[0] = _v3Ticket(accounts[a], buyIn, nextTicketNonce++, keccak256(abi.encodePacked("pa", a)));
        tickets[1] = _v3Ticket(accounts[b], buyIn, nextTicketNonce++, keccak256(abi.encodePacked("pb", b)));
        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _signV3(tickets[0]);
        sigs[1] = _signV3(tickets[1]);

        ArenaVaultV2.SessionDescriptor memory desc = _descriptor(tickets, keccak256(abi.encodePacked("v3", seed, nextTicketNonce)));
        if (isActive[desc.sessionId]) return;

        try vault.sealAndFundSession(desc, tickets, sigs) {
            _trackSession(desc.sessionId, true, desc.participantRoot, tickets[0].arenaAccount, tickets[1].arenaAccount);
            callsSealV3++;
        } catch {}
    }

    /// @notice Conservation-preserving settle: startSum == endSum + rake; payouts to sealed accounts only.
    function settleSession(uint256 sessionSeed, uint256 rakeSeed, uint256 splitSeed) external {
        uint256 n = activeSessions.length;
        if (n == 0) return;
        bytes32 sid = activeSessions[sessionSeed % n];
        address[] memory parts = _participants[sid];
        if (parts.length != 2) return;

        uint256 lock0 = vault.lockedBySession(sid, parts[0]);
        uint256 lock1 = vault.lockedBySession(sid, parts[1]);
        if (lock0 == 0 || lock1 == 0) return;

        uint256 startSum = lock0 + lock1;
        uint256 rake = bound(rakeSeed, 0, startSum / 10); // ≤ 10% of pot
        uint256 endSum = startSum - rake;
        uint256 end0 = bound(splitSeed, 0, endSum);
        uint256 end1 = endSum - end0;

        ArenaVaultV2.SettlementPlayer[] memory players = new ArenaVaultV2.SettlementPlayer[](2);
        players[0] = ArenaVaultV2.SettlementPlayer(parts[0], lock0, end0);
        players[1] = ArenaVaultV2.SettlementPlayer(parts[1], lock1, end1);

        // Handler is settlement hub — checkpoint then settle.
        uint64 seq = nextCheckpointSeq++;
        try vault.applyCheckpoint(
            sid, seq, keccak256(abi.encodePacked(sid, "bal", seq)), keccak256(abi.encodePacked(sid, "evt", seq))
        ) {
            try vault.settleSession(sid, players, rake) {
                _untrack(sid);
                callsSettle++;
            } catch {}
        } catch {}
    }

    function withdrawProtocolFees(uint256 amountSeed) external {
        uint256 accrued = vault.accruedProtocolFees();
        if (accrued == 0) return;
        uint256 amount = bound(amountSeed, 1, accrued);
        vm.prank(testOwner);
        try vault.withdrawProtocolFees(amount) {
            callsWithdrawFees++;
        } catch {}
    }

    function sweepFeeVault(uint256 amountSeed) external {
        uint256 accrued = feeVault.accruedFees();
        if (accrued == 0) return;
        uint256 amount = bound(amountSeed, 1, accrued);
        vm.prank(testOwner);
        try feeVault.sweep(amount, bytes32(uint256(block.number)), bytes32(uint256(callsSweep))) {
            ghostFeesSwept += amount;
            callsSweep++;
        } catch {}
    }

    /// @notice Adversarial: settle with fee vault / EOA / zero as a player destination.
    function tryBadSettleDestination(uint256 sessionSeed, uint8 destKind) external {
        uint256 n = activeSessions.length;
        if (n == 0) return;
        bytes32 sid = activeSessions[sessionSeed % n];
        address[] memory parts = _participants[sid];
        if (parts.length != 2) return;

        uint256 lock0 = vault.lockedBySession(sid, parts[0]);
        uint256 lock1 = vault.lockedBySession(sid, parts[1]);
        if (lock0 == 0 || lock1 == 0) return;

        address bad;
        uint8 kind = destKind % 3;
        if (kind == 0) bad = address(feeVault);
        else if (kind == 1) bad = treasurySafe;
        else bad = address(0);

        ArenaVaultV2.SettlementPlayer[] memory players = new ArenaVaultV2.SettlementPlayer[](2);
        players[0] = ArenaVaultV2.SettlementPlayer(bad, lock0, lock0);
        players[1] = ArenaVaultV2.SettlementPlayer(parts[1], lock1, lock1);

        uint64 seq = nextCheckpointSeq++;
        try vault.applyCheckpoint(
            sid, seq, keccak256(abi.encodePacked(sid, "bad", seq)), keccak256(abi.encodePacked(sid, "badev", seq))
        ) {
            try vault.settleSession(sid, players, 0) {
                ghostBrokenBadSettle = true;
            } catch {
                callsBadSettle++;
            }
        } catch {
            callsBadSettle++;
        }
    }

    /// @notice Adversarial: top-up a V3 sealed session (must revert SessionSealedImmutable).
    function tryTopUpSealed(uint256 sessionSeed, uint256 buyInSeed) external {
        // External self-call so any unexpected panic is swallowed (fail_on_revert noise).
        try this.tryTopUpSealedInner(sessionSeed, buyInSeed) {} catch {}
    }

    function tryTopUpSealedInner(uint256 sessionSeed, uint256 buyInSeed) external {
        require(msg.sender == address(this), "only-self");
        uint256 n = activeSessions.length;
        if (n == 0) return;
        bytes32 sid = activeSessions[sessionSeed % n];
        if (!isV3[sid]) return;
        address[] memory parts = _participants[sid];
        if (parts.length == 0) return;

        uint256 buyIn = bound(buyInSeed, ONE, 50 * ONE);
        // Prefer a non-participant so DuplicateParticipant is not the only revert reason.
        address extra = accounts[(sessionSeed + 2) % NUM_PLAYERS];
        if (vault.sessionParticipants(sid, extra)) extra = parts[0];

        ArenaVaultV2.SeatTicket memory ticket = _v2Ticket(extra, buyIn, nextTicketNonce++);
        bytes memory sig = _signV2(ticket);
        uint256 countBefore = vault.sessionParticipantCount(sid);
        try vault.topUpSession(sid, ticket, sig) {
            ghostBrokenTopUpSealed = true;
        } catch {
            if (vault.sessionParticipantCount(sid) != countBefore) {
                ghostBrokenTopUpSealed = true;
            } else {
                callsTopUpSealed++;
            }
        }
    }

    /// @notice Adversarial: buy-in above maxSingleBuyIn (must not increase locks).
    function tryOverCapBuyIn(uint256 seed) external {
        (uint256 a, uint256 b) = _twoPlayers(seed);
        // Permission maxSingleBuyIn is 500 * ONE in setUp.
        uint256 buyIn = 501 * ONE;
        if (usdc.balanceOf(accounts[a]) < buyIn || usdc.balanceOf(accounts[b]) < buyIn) {
            usdc.mint(accounts[a], buyIn);
            usdc.mint(accounts[b], buyIn);
            ghostUsdcMintedToAccounts += 2 * buyIn;
        }

        bytes32 sid = keccak256(abi.encodePacked("overcap", seed, nextTicketNonce));
        ArenaVaultV2.SeatTicket[] memory tickets = new ArenaVaultV2.SeatTicket[](2);
        bytes[] memory sigs = new bytes[](2);
        tickets[0] = _v2Ticket(accounts[a], buyIn, nextTicketNonce++);
        tickets[1] = _v2Ticket(accounts[b], buyIn, nextTicketNonce++);
        sigs[0] = _signV2(tickets[0]);
        sigs[1] = _signV2(tickets[1]);

        uint256 lockedBefore = vault.totalLocked(accounts[a]) + vault.totalLocked(accounts[b]);
        try vault.openSession(
            ArenaVaultV2.SessionConfig({
                sessionId: sid,
                gameTemplateId: templateId,
                dealerRoot: bytes32(0),
                engineHash: bytes32(0),
                profileSetHash: bytes32(0),
                emergencyExitDelay: 7 days
            }),
            tickets,
            sigs
        ) {
            ghostBrokenOverCap = true;
        } catch {
            uint256 lockedAfter = vault.totalLocked(accounts[a]) + vault.totalLocked(accounts[b]);
            if (lockedAfter != lockedBefore) {
                ghostBrokenOverCap = true;
            } else {
                callsOverCap++;
            }
        }
    }

    /// @notice Adversarial: mutate lifecycle participant roots after SEALED.
    function tryPostSealDraftMutation(uint256 sessionSeed) external {
        uint256 n = activeSessions.length;
        if (n == 0) return;
        bytes32 sid = activeSessions[sessionSeed % n];
        if (!isV3[sid]) return;

        SessionLifecycleV2.SessionRecord memory rec = lifecycle.getSession(sid);
        if (rec.state == SessionLifecycleV2.State.None || rec.state == SessionLifecycleV2.State.Draft) return;

        bytes32 evil = keccak256("evil-participants");
        bytes32 rootBefore = lifecycle.getSession(sid).participantRoot;
        try lifecycle.setDraftCommitments(sid, evil, evil, evil, evil) {
            ghostBrokenPostSealMutation = true;
        } catch {
            if (lifecycle.getSession(sid).participantRoot != rootBefore) {
                ghostBrokenPostSealMutation = true;
            } else {
                callsPostSealMutation++;
            }
        }
    }

    /// @notice Owner withdraws idle USDC from an ArenaAccount (never locked funds in vault).
    function ownerWithdrawIdle(uint256 playerSeed, uint256 amountSeed) external {
        uint256 i = playerSeed % NUM_PLAYERS;
        uint256 bal = usdc.balanceOf(accounts[i]);
        if (bal == 0) return;
        uint256 amount = bound(amountSeed, 1, bal);
        vm.prank(owners[i]);
        try ArenaAccount(accounts[i]).withdraw(address(usdc), amount, owners[i]) {} catch {}
    }

    function warpAhead(uint256 seed) external {
        uint256 dt = bound(seed, 1, 1 days);
        vm.warp(block.timestamp + dt);
    }

    // -------------------------------------------------------------------------
    // Views for invariants
    // -------------------------------------------------------------------------

    function sumTotalLocked() public view returns (uint256 sum) {
        for (uint256 i = 0; i < NUM_PLAYERS; i++) {
            sum += vault.totalLocked(accounts[i]);
        }
    }

    function vaultLiabilities() public view returns (uint256) {
        return sumTotalLocked() + vault.accruedProtocolFees();
    }

    // -------------------------------------------------------------------------
    // Internal helpers
    // -------------------------------------------------------------------------

    function _trackSession(bytes32 sid, bool v3, bytes32 participantRoot, address p0, address p1) internal {
        activeSessions.push(sid);
        isActive[sid] = true;
        isV3[sid] = v3;
        ghostParticipantCount[sid] = 2;
        ghostParticipantRoot[sid] = participantRoot;
        delete _participants[sid];
        _participants[sid].push(p0);
        _participants[sid].push(p1);
    }

    function _untrack(bytes32 sid) internal {
        isActive[sid] = false;
        uint256 n = activeSessions.length;
        for (uint256 i = 0; i < n; i++) {
            if (activeSessions[i] == sid) {
                activeSessions[i] = activeSessions[n - 1];
                activeSessions.pop();
                break;
            }
        }
    }

    function _twoPlayers(uint256 seed) internal pure returns (uint256 a, uint256 b) {
        a = seed % NUM_PLAYERS;
        b = (seed / NUM_PLAYERS + 1) % NUM_PLAYERS;
        if (a == b) b = (a + 1) % NUM_PLAYERS;
    }

    function _canLock(address account, uint256 buyIn) internal view returns (bool) {
        if (usdc.balanceOf(account) < buyIn) return false;
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
            uint64 validUntil,
            uint16 maxConcurrent,
            uint16 activeGames,
            ,
            bool enabled
        ) = ArenaAccount(account).gameAuth();
        if (!enabled || block.timestamp > validUntil) return false;
        if (buyIn > maxSingle) return false;
        if (lifetimeCommitted + buyIn > lifetimeCap) return false;
        if (activeAtRisk + buyIn > maxAtRisk) return false;
        if (uint256(activeGames) + 1 > maxConcurrent) return false;
        return true;
    }

    function _v2Ticket(address player, uint256 buyIn, uint256 nonce)
        internal
        view
        returns (ArenaVaultV2.SeatTicket memory)
    {
        return ArenaVaultV2.SeatTicket({
            player: player,
            gameTemplateId: templateId,
            buyIn: buyIn,
            controllerHash: keccak256("ctrl"),
            agentProfileHash: keccak256(abi.encodePacked("profile", player)),
            expiresAt: uint64(block.timestamp + 30 days),
            nonce: nonce,
            matchmakingPool: keccak256("pool"),
            leagueBit: LEAGUE_MICRO,
            rated: true
        });
    }

    function _v3Ticket(address account, uint256 buyIn, uint256 nonce, bytes32 profile)
        internal
        view
        returns (ArenaVaultV2.SeatTicketV3 memory)
    {
        return ArenaVaultV2.SeatTicketV3({
            arenaAccount: account,
            gameTemplateId: templateId,
            matchmakingPool: keccak256("pool"),
            buyIn: buyIn,
            controllerHash: keccak256("ctrl"),
            profileConfigHash: profile,
            modelPolicyHash: keccak256("model"),
            leagueBit: LEAGUE_MICRO,
            rated: true,
            expiresAt: uint64(block.timestamp + 30 days),
            nonce: nonce
        });
    }

    function _signV2(ArenaVaultV2.SeatTicket memory ticket) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(
                SEAT_TICKET_TYPEHASH,
                ticket.player,
                ticket.gameTemplateId,
                ticket.buyIn,
                ticket.controllerHash,
                ticket.agentProfileHash,
                ticket.expiresAt,
                ticket.nonce,
                ticket.matchmakingPool,
                ticket.leagueBit,
                ticket.rated
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", _vaultDomain(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(sessionSignerPk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _signV3(ArenaVaultV2.SeatTicketV3 memory ticket) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(
                SEAT_TICKET_V3_TYPEHASH,
                ticket.arenaAccount,
                ticket.gameTemplateId,
                ticket.matchmakingPool,
                ticket.buyIn,
                ticket.controllerHash,
                ticket.profileConfigHash,
                ticket.modelPolicyHash,
                ticket.leagueBit,
                ticket.rated,
                ticket.expiresAt,
                ticket.nonce
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", _vaultDomain(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(sessionSignerPk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _vaultDomain() internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("MozettoArenaVault")),
                keccak256(bytes("2")),
                block.chainid,
                address(vault)
            )
        );
    }

    function _descriptor(ArenaVaultV2.SeatTicketV3[] memory tickets, bytes32 sessionNonce)
        internal
        view
        returns (ArenaVaultV2.SessionDescriptor memory desc)
    {
        uint256 n = tickets.length;
        bytes32[] memory pLeaves = new bytes32[](n);
        bytes32[] memory oLeaves = new bytes32[](n);
        bytes32[] memory cLeaves = new bytes32[](n);
        bytes32[] memory prLeaves = new bytes32[](n);

        // sessionId depends on participantRoot — build leaves with provisional sessionId after roots? 
        // Plan: sessionId = H(DOMAIN, chainId, template, participantRoot, sessionNonce, createdAt)
        // opening leaves include sessionId — chicken/egg: opening root uses sessionId which uses participant root only.
        // So: compute participantRoot first, then sessionId, then opening leaves with that sessionId.

        for (uint256 i = 0; i < n; i++) {
            address owner = factory.ownerOf(tickets[i].arenaAccount);
            uint8 seat = uint8(i);
            pLeaves[i] = keccak256(
                abi.encode(
                    DOMAIN_PARTICIPANT_LEAF_V1,
                    owner,
                    tickets[i].arenaAccount,
                    seat,
                    tickets[i].buyIn,
                    tickets[i].controllerHash,
                    tickets[i].profileConfigHash,
                    tickets[i].matchmakingPool,
                    tickets[i].rated,
                    tickets[i].nonce
                )
            );
            cLeaves[i] = keccak256(abi.encode(DOMAIN_CONTROLLER_LEAF_V1, seat, tickets[i].controllerHash));
            prLeaves[i] = tickets[i].profileConfigHash;
        }

        bytes32 participantRoot = _orderedMerkleRoot(pLeaves);
        uint64 createdAt = uint64(block.timestamp);
        bytes32 sessionId = keccak256(
            abi.encode(DOMAIN_SESSION_ID_V1, block.chainid, templateId, participantRoot, sessionNonce, createdAt)
        );

        for (uint256 i = 0; i < n; i++) {
            oLeaves[i] = keccak256(
                abi.encode(DOMAIN_OPENING_BALANCE_LEAF_V1, sessionId, tickets[i].arenaAccount, uint8(i), tickets[i].buyIn)
            );
        }

        desc = ArenaVaultV2.SessionDescriptor({
            chainId: block.chainid,
            protocolVersion: 3,
            sessionId: sessionId,
            gameTemplateId: templateId,
            participantRoot: participantRoot,
            openingBalanceRoot: _orderedMerkleRoot(oLeaves),
            controllerRoot: _orderedMerkleRoot(cLeaves),
            profileRoot: _orderedMerkleRoot(prLeaves),
            dealerSecretRoot: keccak256("dealer"),
            randomnessPolicyId: keccak256("rand"),
            settlementPolicyId: keccak256("settle"),
            createdAt: createdAt,
            sealDeadline: uint64(block.timestamp + 1 days),
            sessionNonce: sessionNonce
        });
    }

    function _orderedMerkleRoot(bytes32[] memory leaves) internal pure returns (bytes32) {
        uint256 n = leaves.length;
        if (n == 0) return bytes32(0);
        uint256 size = 1;
        while (size < n) size <<= 1;
        bytes32[] memory level = new bytes32[](size);
        for (uint256 i = 0; i < n; i++) {
            level[i] = leaves[i];
        }
        while (size > 1) {
            uint256 nextSize = size >> 1;
            bytes32[] memory next = new bytes32[](nextSize);
            for (uint256 i = 0; i < nextSize; i++) {
                next[i] = keccak256(abi.encodePacked(level[i * 2], level[i * 2 + 1]));
            }
            level = next;
            size = nextSize;
        }
        return level[0];
    }
}
