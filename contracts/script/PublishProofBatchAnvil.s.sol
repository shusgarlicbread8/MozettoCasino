// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {ProofBatchRegistryV1} from "../src/ProofBatchRegistryV1.sol";

/// @dev WP-062 publisher stub — register a continuity-valid batch on Anvil.
///      Full settlement/proof-batch worker = WP-084/085.
///
/// Usage (registry already deployed via DeployLocal):
///   PROOF_BATCH_REGISTRY_ADDRESS=0x... forge script script/PublishProofBatchAnvil.s.sol \
///     --rpc-url http://127.0.0.1:8545 --broadcast
///
/// Or deploy+publish in one shot when PROOF_BATCH_REGISTRY_ADDRESS is unset.
contract PublishProofBatchAnvil is Script {
    function run() external {
        uint256 pk = vm.envOr("PRIVATE_KEY", uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80));
        address deployer = vm.addr(pk);

        vm.startBroadcast(pk);
        ProofBatchRegistryV1 registry = _resolve(deployer);
        _publish(registry);
        vm.stopBroadcast();
    }

    function _resolve(address deployer) internal returns (ProofBatchRegistryV1 registry) {
        address existing = vm.envOr("PROOF_BATCH_REGISTRY_ADDRESS", address(0));
        if (existing != address(0)) {
            registry = ProofBatchRegistryV1(existing);
            console2.log("ProofBatchRegistryV1 (existing)", existing);
            return registry;
        }
        registry = new ProofBatchRegistryV1(deployer, deployer, 0);
        console2.log("ProofBatchRegistryV1 (fresh)", address(registry));
    }

    function _publish(ProofBatchRegistryV1 registry) internal {
        uint64 seq = registry.nextSequence();
        bytes32 prev = seq == 0 ? bytes32(0) : registry.getBatch(seq - 1).globalRoot;

        bytes32 globalRoot = _fixtureGlobalRoot(registry, seq);
        bytes32 manifest = keccak256(abi.encodePacked("anvil-manifest", seq));

        bytes32 hash = registry.registerBatch(
            ProofBatchRegistryV1.ProofBatch({
                sequence: seq,
                previousBatchRoot: prev,
                globalRoot: globalRoot,
                dataManifestHash: manifest,
                createdAt: uint64(block.timestamp)
            })
        );

        console2.log("sequence", seq);
        console2.logBytes32(globalRoot);
        console2.logBytes32(hash);
        console2.log("nextSequence", registry.nextSequence());
    }

    function _fixtureGlobalRoot(ProofBatchRegistryV1 registry, uint64 seq) internal view returns (bytes32) {
        bytes32[] memory checkpoints = new bytes32[](3);
        checkpoints[0] = keccak256(abi.encodePacked("anvil-checkpoint", seq, uint8(0)));
        checkpoints[1] = keccak256(abi.encodePacked("anvil-checkpoint", seq, uint8(1)));
        checkpoints[2] = keccak256(abi.encodePacked("anvil-checkpoint", seq, uint8(2)));
        return registry.computeGlobalRoot(checkpoints);
    }
}
