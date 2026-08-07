// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {stdJson} from "forge-std/StdJson.sol";

/// @notice WP-015: Solidity golden-vector conformance against specs/canonical-vectors.
/// Independently ABI-encodes and keccak256-hashes; compares to fixture digests.
contract ProtocolVectorsTest is Test {
    using stdJson for string;

    string constant VECTORS = "../specs/canonical-vectors/";

    function _load(string memory name) internal view returns (string memory) {
        return vm.readFile(string.concat(VECTORS, name));
    }

    function _expected(string memory name) internal view returns (bytes32) {
        return _load(name).readBytes32(".keccak256");
    }

    function _domain(string memory s) internal pure returns (bytes32) {
        return keccak256(bytes(s));
    }

    function _merkleRoot(bytes32[] memory leaves) internal pure returns (bytes32) {
        if (leaves.length == 0) return bytes32(0);
        uint256 n = leaves.length;
        while (n & (n - 1) != 0) {
            // pad to power of 2 — rebuild into temp array
            n++;
        }
        bytes32[] memory level = new bytes32[](n);
        for (uint256 i = 0; i < leaves.length; i++) {
            level[i] = leaves[i];
        }
        // remaining already zero
        while (level.length > 1) {
            bytes32[] memory next = new bytes32[](level.length / 2);
            for (uint256 i = 0; i < level.length; i += 2) {
                next[i / 2] = keccak256(bytes.concat(level[i], level[i + 1]));
            }
            level = next;
        }
        return level[0];
    }

    function test_domains() public view {
        string memory j = _load("_domains.json");
        assertEq(_domain("MOZETTO_SESSION_V2"), j.readBytes32(".SESSION_V2"));
        assertEq(_domain("MOZETTO_SESSION_ID_V1"), j.readBytes32(".SESSION_ID_V1"));
        assertEq(_domain("MOZETTO_HAND_ID_V1"), j.readBytes32(".HAND_ID_V1"));
        assertEq(_domain("MOZETTO_PARTICIPANT_LEAF_V1"), j.readBytes32(".PARTICIPANT_LEAF_V1"));
        assertEq(_domain("MOZETTO_EVENT_V1"), j.readBytes32(".EVENT_V1"));
        assertEq(_domain("MOZETTO_CARD_LEAF_V1"), j.readBytes32(".CARD_LEAF_V1"));
        assertEq(_domain("MOZETTO_DECK_ROOT_V1"), j.readBytes32(".DECK_ROOT_V1"));
        assertEq(_domain("MOZETTO_SECRET_LEAF_V1"), j.readBytes32(".SECRET_LEAF_V1"));
        assertEq(_domain("MOZETTO_HAND_SEED_V1"), j.readBytes32(".HAND_SEED_V1"));
        assertEq(_domain("MOZETTO_BALANCE_LEAF_V1"), j.readBytes32(".BALANCE_LEAF_V1"));
        assertEq(_domain("MOZETTO_PROFILE_V1"), j.readBytes32(".PROFILE_V1"));
        assertEq(_domain("MOZETTO_MODEL_POLICY_V1"), j.readBytes32(".MODEL_POLICY_V1"));
        assertEq(_domain("MOZETTO_PROOF_BATCH_V1"), j.readBytes32(".PROOF_BATCH_V1"));
        assertEq(_domain("MOZETTO_SETTLEMENT_V3"), j.readBytes32(".SETTLEMENT_V3"));
        assertEq(_domain("MOZETTO_ENERGY_OP_V1"), j.readBytes32(".ENERGY_OP_V1"));
        assertEq(_domain("MOZETTO_ENERGY_LEDGER_V1"), j.readBytes32(".ENERGY_LEDGER_V1"));
        assertEq(_domain("MOZETTO_GAME_TEMPLATE_V2"), j.readBytes32(".GAME_TEMPLATE_V2"));
        assertEq(_domain("MOZETTO_CONTROLLER_REQUEST_V1"), j.readBytes32(".CONTROLLER_REQ_V1"));
        assertEq(_domain("MOZETTO_CONTROLLER_RESPONSE_V1"), j.readBytes32(".CONTROLLER_RESP_V1"));
        assertEq(_domain("MOZETTO_OPENING_BALANCE_LEAF_V1"), j.readBytes32(".OPENING_BALANCE_LEAF_V1"));
        assertEq(_domain("MOZETTO_CONTROLLER_LEAF_V1"), j.readBytes32(".CONTROLLER_LEAF_V1"));
        assertEq(_domain("MOZETTO_DECK_BATCH_V1"), j.readBytes32(".DECK_BATCH_V1"));
        assertEq(_domain("MOZETTO_HAND_ROOT_V1"), j.readBytes32(".HAND_ROOT_V1"));
    }

    function _sessionDescriptorHash(string memory json) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                _domain("MOZETTO_SESSION_V2"),
                json.readUint(".expectedDecodedStructure.chainId"),
                uint16(json.readUint(".expectedDecodedStructure.protocolVersion")),
                json.readBytes32(".expectedDecodedStructure.sessionId"),
                json.readBytes32(".expectedDecodedStructure.gameTemplateId"),
                json.readBytes32(".expectedDecodedStructure.participantRoot"),
                json.readBytes32(".expectedDecodedStructure.openingBalanceRoot"),
                json.readBytes32(".expectedDecodedStructure.controllerRoot"),
                json.readBytes32(".expectedDecodedStructure.profileRoot"),
                json.readBytes32(".expectedDecodedStructure.dealerSecretRoot"),
                json.readBytes32(".expectedDecodedStructure.randomnessPolicyId"),
                json.readBytes32(".expectedDecodedStructure.settlementPolicyId"),
                uint64(json.readUint(".expectedDecodedStructure.createdAt")),
                uint64(json.readUint(".expectedDecodedStructure.sealDeadline")),
                json.readBytes32(".expectedDecodedStructure.sessionNonce")
            )
        );
    }

    function test_01_session_hu() public view {
        string memory j = _load("01_session_hu.json");
        assertEq(_sessionDescriptorHash(j), j.readBytes32(".keccak256"));
    }

    function test_02_session_sixmax() public view {
        string memory j = _load("02_session_sixmax.json");
        assertEq(_sessionDescriptorHash(j), j.readBytes32(".keccak256"));
    }

    function _eventHash(
        bytes32 sessionId,
        uint64 handNumber,
        uint64 sequence,
        uint16 eventType,
        bool hasActorSeat,
        uint8 actorSeat,
        bytes32 publicPayloadHash,
        bytes32 privatePayloadCommitment,
        uint64 elapsedMs,
        bytes32 previousEventHash,
        bytes32 engineHash
    ) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                _domain("MOZETTO_EVENT_V1"),
                uint16(3),
                sessionId,
                uint64(0),
                handNumber,
                sequence,
                eventType,
                hasActorSeat,
                actorSeat,
                publicPayloadHash,
                privatePayloadCommitment,
                elapsedMs,
                previousEventHash,
                engineHash
            )
        );
    }

    function test_03_preflop_sequence() public view {
        string memory j = _load("03_preflop_sequence.json");
        bytes32 sessionId = _load("01_session_hu.json").readBytes32(".expectedDecodedStructure.sessionId");
        bytes32 engine = keccak256(bytes("mozetto-nlhe-engine-v3-draft"));
        bytes32 prev = bytes32(0);

        prev = _eventHash(
            sessionId, 1, 0, 1, false, 0, keccak256(bytes("hand-start-1")), bytes32(0), 0, prev, engine
        );
        prev = _eventHash(
            sessionId,
            1,
            1,
            2,
            true,
            0,
            keccak256(abi.encode(uint8(0), uint256(500_000))),
            bytes32(0),
            10,
            prev,
            engine
        );
        prev = _eventHash(
            sessionId,
            1,
            2,
            2,
            true,
            1,
            keccak256(abi.encode(uint8(1), uint256(1_000_000))),
            bytes32(0),
            20,
            prev,
            engine
        );
        prev = _eventHash(
            sessionId,
            1,
            3,
            3,
            false,
            0,
            keccak256(bytes("hole-dealt-committed")),
            keccak256(bytes("private-hole-commitment")),
            50,
            prev,
            engine
        );
        prev = _eventHash(
            sessionId,
            1,
            4,
            14,
            true,
            0,
            keccak256(abi.encode(uint8(0), uint16(14), uint256(3_000_000))),
            bytes32(0),
            4200,
            prev,
            engine
        );
        prev = _eventHash(
            sessionId,
            1,
            5,
            12,
            true,
            1,
            keccak256(abi.encode(uint8(1), uint16(12), uint256(2_000_000))),
            bytes32(0),
            8100,
            prev,
            engine
        );

        assertEq(prev, j.readBytes32(".keccak256"));
    }

    function test_04_incomplete_allin() public view {
        string memory j = _load("04_incomplete_allin_raise.json");
        bytes32 sessionId = _load("01_session_hu.json").readBytes32(".expectedDecodedStructure.sessionId");
        bytes32 engine = keccak256(bytes("mozetto-nlhe-engine-v3-draft"));
        bytes32 prev = bytes32(0);
        prev = _eventHash(
            sessionId,
            2,
            0,
            14,
            true,
            0,
            keccak256(abi.encode(uint8(0), uint16(14), uint256(3_000_000))),
            bytes32(0),
            3000,
            prev,
            engine
        );
        prev = _eventHash(
            sessionId,
            2,
            1,
            15,
            true,
            1,
            keccak256(abi.encode(uint8(1), uint16(15), uint256(2_500_000))),
            bytes32(0),
            5500,
            prev,
            engine
        );
        prev = _eventHash(
            sessionId,
            2,
            2,
            12,
            true,
            0,
            keccak256(abi.encode(uint8(0), uint16(12), uint256(0))),
            bytes32(0),
            7000,
            prev,
            engine
        );
        assertEq(prev, j.readBytes32(".keccak256"));
    }

    function test_05_side_pot_balance_root() public view {
        string memory j = _load("05_three_way_side_pot.json");
        bytes32 sid = _load("02_session_sixmax.json").readBytes32(".expectedDecodedStructure.sessionId");
        bytes32 d = _domain("MOZETTO_BALANCE_LEAF_V1");
        bytes32[] memory leaves = new bytes32[](3);
        address aliceArena = address(uint160(uint256(bytes32(hex"000000000000000000000000a111111111111111111111111111111111111111"))));
        address bobArena = address(uint160(uint256(bytes32(hex"000000000000000000000000a222222222222222222222222222222222222222"))));
        address carolArena = address(uint160(uint256(bytes32(hex"000000000000000000000000a333333333333333333333333333333333333333"))));
        leaves[0] = keccak256(
            abi.encode(
                d, sid, uint64(0), aliceArena, uint8(0),
                uint256(100_000_000), uint256(140_000_000), uint256(0), uint64(100)
            )
        );
        leaves[1] = keccak256(
            abi.encode(
                d, sid, uint64(0), bobArena, uint8(1),
                uint256(100_000_000), uint256(50_000_000), uint256(0), uint64(100)
            )
        );
        leaves[2] = keccak256(
            abi.encode(
                d, sid, uint64(0), carolArena, uint8(2),
                uint256(100_000_000), uint256(110_000_000), uint256(0), uint64(100)
            )
        );
        assertEq(_merkleRoot(leaves), j.readBytes32(".keccak256"));
    }

    function test_06_odd_chip() public view {
        string memory j = _load("06_split_pot_odd_chip.json");
        bytes32 h = keccak256(
            abi.encode(uint256(1_000_001), uint8(0), uint8(0), uint8(1), uint256(500_000), uint256(500_001))
        );
        assertEq(h, j.readBytes32(".keccak256"));
    }

    function test_07_card_leaf_merkle() public view {
        string memory j = _load("07_card_leaf_merkle.json");
        bytes32 handId = j.readBytes32(".humanReadableInput.handId");
        bytes32 salt0 = j.readBytes32(".leaf0.cardSalt");
        bytes32 leaf0 = keccak256(
            abi.encode(_domain("MOZETTO_CARD_LEAF_V1"), handId, uint8(0), uint8(0), salt0)
        );
        assertEq(leaf0, j.readBytes32(".keccak256"));

        bytes32[] memory leaves = new bytes32[](52);
        for (uint8 i = 0; i < 52; i++) {
            bytes32 salt = keccak256(bytes(string.concat("card-salt-", vm.toString(i))));
            leaves[i] = keccak256(
                abi.encode(_domain("MOZETTO_CARD_LEAF_V1"), handId, i, i, salt)
            );
        }
        assertEq(_merkleRoot(leaves), j.readBytes32(".deckRoot"));
    }

    function test_08_secret_hand_seed() public view {
        string memory j = _load("08_dealer_secret_hand_seed.json");
        bytes32 sessionId = j.readBytes32(".humanReadableInput.sessionId");
        bytes32 vrfR = j.readBytes32(".humanReadableInput.vrfR");
        bytes32 s0 = keccak256(bytes("dealer-secret-0"));
        bytes32 leaf = keccak256(
            abi.encode(_domain("MOZETTO_SECRET_LEAF_V1"), sessionId, uint64(0), uint16(0), s0)
        );
        assertEq(leaf, j.readBytes32(".keccak256"));

        bytes32 seed = keccak256(
            abi.encode(_domain("MOZETTO_HAND_SEED_V1"), s0, vrfR, sessionId, uint64(0), uint16(0))
        );
        assertEq(seed, j.readBytes32(".handSeed0"));

        bytes32 s1 = keccak256(bytes("dealer-secret-1"));
        bytes32[] memory leaves = new bytes32[](2);
        leaves[0] = leaf;
        leaves[1] = keccak256(
            abi.encode(_domain("MOZETTO_SECRET_LEAF_V1"), sessionId, uint64(0), uint16(1), s1)
        );
        assertEq(_merkleRoot(leaves), j.readBytes32(".dealerSecretRoot"));
    }

    function test_09_profile() public view {
        string memory j = _load("09_profile_hash.json");
        string memory p = ".expectedDecodedStructure";
        bytes32 h = keccak256(
            abi.encode(
                _domain("MOZETTO_PROFILE_V1"),
                j.readBytes32(string.concat(p, ".profileId")),
                uint16(j.readUint(string.concat(p, ".profileVersion"))),
                j.readBytes32(string.concat(p, ".presetId")),
                uint8(j.readUint(string.concat(p, ".aggression"))),
                uint8(j.readUint(string.concat(p, ".riskTolerance"))),
                uint8(j.readUint(string.concat(p, ".deception"))),
                uint8(j.readUint(string.concat(p, ".opponentAdaptation"))),
                uint8(j.readUint(string.concat(p, ".trapPreference"))),
                uint8(j.readUint(string.concat(p, ".tempo"))),
                uint8(j.readUint(string.concat(p, ".variancePreference"))),
                uint8(j.readUint(string.concat(p, ".energyConservation"))),
                uint32(j.readUint(string.concat(p, ".allowedSchedulerWeights"))),
                uint64(j.readUint(string.concat(p, ".createdAt"))),
                uint32(j.readUint(string.concat(p, ".ownerCustomizationVersion")))
            )
        );
        assertEq(h, j.readBytes32(".keccak256"));
    }

    function test_10_model_policy() public view {
        string memory j = _load("10_model_policy_groq.json");
        string memory p = ".expectedDecodedStructure";
        bytes32 h = keccak256(
            abi.encode(
                _domain("MOZETTO_MODEL_POLICY_V1"),
                j.readBytes32(string.concat(p, ".policyId")),
                uint16(j.readUint(string.concat(p, ".policyVersion"))),
                j.readBytes32(string.concat(p, ".providerId")),
                j.readBytes32(string.concat(p, ".modelId")),
                j.readBytes32(string.concat(p, ".reasoningEffortPolicy")),
                j.readBytes32(string.concat(p, ".outputMode")),
                uint32(j.readUint(string.concat(p, ".maxOutputTokens"))),
                uint32(j.readUint(string.concat(p, ".temperatureMilli"))),
                j.readBytes32(string.concat(p, ".masterPolicyHash")),
                j.readBytes32(string.concat(p, ".profileSetHash")),
                j.readBytes32(string.concat(p, ".energyPolicyHash")),
                j.readBytes32(string.concat(p, ".contextTruncationPolicy")),
                j.readBytes32(string.concat(p, ".fallbackPolicyHash")),
                j.readBool(string.concat(p, ".toolsDisabled"))
            )
        );
        assertEq(h, j.readBytes32(".keccak256"));
    }

    function test_11_energy_ledger() public view {
        string memory j = _load("11_energy_ledger_hand.json");
        bytes32[] memory opHashes = new bytes32[](4);
        opHashes[0] = j.readBytes32(".operations[0].opHash");
        opHashes[1] = j.readBytes32(".operations[1].opHash");
        opHashes[2] = j.readBytes32(".operations[2].opHash");
        opHashes[3] = j.readBytes32(".operations[3].opHash");
        bytes32 opsRoot = _merkleRoot(opHashes);
        assertEq(opsRoot, j.readBytes32(".energyLedgerRoot"));

        bytes32 sessionId = _load("01_session_hu.json").readBytes32(".expectedDecodedStructure.sessionId");
        bytes32 handId = keccak256(
            abi.encode(_domain("MOZETTO_HAND_ID_V1"), sessionId, uint64(0), uint64(1))
        );
        bytes32 h = keccak256(
            abi.encode(
                _domain("MOZETTO_ENERGY_LEDGER_V1"),
                sessionId,
                handId,
                uint8(0),
                uint16(j.readUint(".expectedDecodedStructure.startingEnergy")),
                opsRoot,
                uint16(j.readUint(".expectedDecodedStructure.endingEnergy"))
            )
        );
        assertEq(h, j.readBytes32(".keccak256"));
    }

    function test_12_settlement_eip712() public view {
        string memory j = _load("12_final_settlement_eip712.json");
        string memory p = ".expectedDecodedStructure";
        bytes32 typehash = keccak256(
            "FinalSettlementV3(bytes32 sessionId,uint64 finalSequence,bytes32 finalEventRoot,bytes32 handRoot,bytes32 balanceRoot,bytes32 randomnessEpochId,uint256 openingTotal,uint256 endingPlayerTotal,uint256 totalRake,uint64 proofBatchSequence,bytes32 modelPolicyHash,bytes32 profileSetHash,bytes32 gameTemplateId,bytes32 engineHash,uint256 deadline)"
        );
        bytes32 structHash = keccak256(
            abi.encode(
                typehash,
                j.readBytes32(string.concat(p, ".sessionId")),
                uint64(j.readUint(string.concat(p, ".finalSequence"))),
                j.readBytes32(string.concat(p, ".finalEventRoot")),
                j.readBytes32(string.concat(p, ".handRoot")),
                j.readBytes32(string.concat(p, ".balanceRoot")),
                j.readBytes32(string.concat(p, ".randomnessEpochId")),
                j.readUint(string.concat(p, ".openingTotal")),
                j.readUint(string.concat(p, ".endingPlayerTotal")),
                j.readUint(string.concat(p, ".totalRake")),
                uint64(j.readUint(string.concat(p, ".proofBatchSequence"))),
                j.readBytes32(string.concat(p, ".modelPolicyHash")),
                j.readBytes32(string.concat(p, ".profileSetHash")),
                j.readBytes32(string.concat(p, ".gameTemplateId")),
                j.readBytes32(string.concat(p, ".engineHash")),
                j.readUint(string.concat(p, ".deadline"))
            )
        );
        bytes32 domainSeparator = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("MozettoPokerSettlement"),
                keccak256("3"),
                j.readUint(string.concat(p, ".chainId")),
                j.readAddress(string.concat(p, ".verifyingContract"))
            )
        );
        bytes32 digest = keccak256(abi.encodePacked(hex"1901", domainSeparator, structHash));
        assertEq(typehash, j.readBytes32(".typehash"));
        assertEq(structHash, j.readBytes32(".structHash"));
        assertEq(domainSeparator, j.readBytes32(".domainSeparator"));
        assertEq(digest, j.readBytes32(".keccak256"));
    }

    function test_13_proof_batch() public view {
        string memory j = _load("13_proof_batch_root.json");
        bytes32[] memory checkpoints = new bytes32[](3);
        checkpoints[0] = j.readBytes32(".checkpointRoots[0]");
        checkpoints[1] = j.readBytes32(".checkpointRoots[1]");
        checkpoints[2] = j.readBytes32(".checkpointRoots[2]");
        assertEq(_merkleRoot(checkpoints), j.readBytes32(".globalRoot"));

        string memory p = ".expectedDecodedStructure";
        bytes32 h = keccak256(
            abi.encode(
                _domain("MOZETTO_PROOF_BATCH_V1"),
                uint64(j.readUint(string.concat(p, ".sequence"))),
                j.readBytes32(string.concat(p, ".previousBatchRoot")),
                j.readBytes32(string.concat(p, ".globalRoot")),
                j.readBytes32(string.concat(p, ".dataManifestHash")),
                uint64(j.readUint(string.concat(p, ".createdAt")))
            )
        );
        assertEq(h, j.readBytes32(".keccak256"));
    }

    function test_14_emergency_leaf() public view {
        string memory j = _load("14_emergency_exit_balance_leaf.json");
        string memory f = ".leaf.fields";
        bytes32 h = keccak256(
            abi.encode(
                _domain("MOZETTO_BALANCE_LEAF_V1"),
                j.readBytes32(string.concat(f, ".sessionId")),
                uint64(j.readUint(string.concat(f, ".epoch"))),
                j.readAddress(string.concat(f, ".arenaAccount")),
                uint8(j.readUint(string.concat(f, ".seat"))),
                j.readUint(string.concat(f, ".openingBalance")),
                j.readUint(string.concat(f, ".currentBalance")),
                j.readUint(string.concat(f, ".cumulativeRake")),
                uint64(j.readUint(string.concat(f, ".lastSequence")))
            )
        );
        assertEq(h, j.readBytes32(".keccak256"));
    }
}
