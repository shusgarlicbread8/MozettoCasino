// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {RandomnessBeaconV2} from "../src/RandomnessBeaconV2.sol";

/// @title MockVrfAnvil - WP-052 deterministic beacon lifecycle on Anvil
/// @notice commitSecretRoot -> requestVrf -> fulfillMock -> registerDeckBatch.
///
/// Usage (Anvil running):
///   forge script script/MockVrfAnvil.s.sol --rpc-url http://127.0.0.1:8545 --broadcast -vv
///
/// Env: PRIVATE_KEY, RANDOMNESS_BEACON_ADDRESS, MOCK_VRF_SESSION_SALT, MOCK_VRF_EPOCH
/// Keep fixture salts in sync with `scripts/anvil-mock-vrf-beacon.mjs`.
contract MockVrfAnvil is Script {
    bytes32 internal constant PARTICIPANT_ROOT = keccak256("wp052-participant-root");
    bytes32 internal constant GAME_TEMPLATE = keccak256("NLHE_HU_STANDARD_V2");
    bytes32 internal constant VRF_RESULT = keccak256("wp052-mock-vrf-result");
    bytes32 internal constant DECK_BATCH_ROOT = keccak256("wp052-deck-batch-root");
    bytes32 internal constant ATTESTATION = keccak256("wp052-dealer-attestation");

    function run() external {
        uint256 pk = vm.envOr("PRIVATE_KEY", uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80));
        string memory sessionSalt = vm.envOr("MOCK_VRF_SESSION_SALT", string("wp052-session"));
        uint64 epoch = uint64(vm.envOr("MOCK_VRF_EPOCH", uint256(1)));

        vm.startBroadcast(pk);
        address beaconAddr = _resolveBeacon(vm.addr(pk));
        _drive(beaconAddr, keccak256(bytes(sessionSalt)), epoch, sessionSalt);
        vm.stopBroadcast();

        console2.log("OK - WP-052 mock VRF path verified");
        console2.log("beacon", beaconAddr);
        console2.log("sessionSalt", sessionSalt);
        console2.log("epoch", epoch);
    }

    function _resolveBeacon(address operator) internal returns (address beaconAddr) {
        address existing = vm.envOr("RANDOMNESS_BEACON_ADDRESS", address(0));
        if (existing != address(0)) {
            require(RandomnessBeaconV2(existing).mockVrfEnabled(), "mock VRF disabled");
            console2.log("Using existing RandomnessBeaconV2", existing);
            return existing;
        }
        RandomnessBeaconV2 beacon = new RandomnessBeaconV2(operator, true);
        beacon.setOperator(operator);
        beaconAddr = address(beacon);
        console2.log("Deployed RandomnessBeaconV2 (mock on)", beaconAddr);
    }

    function _drive(address beaconAddr, bytes32 sessionId, uint64 epoch, string memory sessionSalt)
        internal
    {
        RandomnessBeaconV2 beacon = RandomnessBeaconV2(beaconAddr);
        bytes32 secretRoot = keccak256(abi.encodePacked("wp052-dealer-secret-root:", sessionSalt));

        beacon.commitSecretRoot(sessionId, epoch, secretRoot, PARTICIPANT_ROOT, GAME_TEMPLATE);
        uint256 requestId = beacon.requestVrf(sessionId, epoch);
        beacon.fulfillMock(sessionId, epoch, VRF_RESULT);
        beacon.registerDeckBatch(sessionId, epoch, DECK_BATCH_ROOT, ATTESTATION);

        _assertDone(beacon, sessionId, epoch, requestId);
        console2.log("requestId", requestId);
        console2.log("phase DeckBatchRegistered usedMockVrf=true");
    }

    function _assertDone(RandomnessBeaconV2 beacon, bytes32 sessionId, uint64 epoch, uint256 requestId)
        internal
        view
    {
        RandomnessBeaconV2.EpochRecord memory e = beacon.getEpoch(sessionId, epoch);
        require(uint8(e.phase) == uint8(RandomnessBeaconV2.Phase.DeckBatchRegistered), "phase");
        require(e.vrfResult == VRF_RESULT, "vrf");
        require(e.usedMockVrf, "mock");
        require(e.vrfRequestId == requestId, "requestId");
        require(e.committedAt <= e.requestedAt, "ts1");
        require(e.requestedAt <= e.fulfilledAt, "ts2");
        require(e.deckBatchRoot == DECK_BATCH_ROOT, "deck");
        require(e.deckBatchBind == beacon.computeDeckBatchBind(sessionId, epoch, DECK_BATCH_ROOT), "bind");
    }
}
