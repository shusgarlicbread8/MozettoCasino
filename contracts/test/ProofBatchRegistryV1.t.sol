// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {ProofBatchRegistryV1} from "../src/ProofBatchRegistryV1.sol";

/// @dev WP-062: registry continuity + domain encoding vs golden vector 13.
contract ProofBatchRegistryV1Test is Test {
    using stdJson for string;

    ProofBatchRegistryV1 registry;

    address owner = address(this);
    address publisher = address(0xB0B);
    address stranger = address(0xBAD);
    address newPublisher = address(0xCE11);

    function setUp() public {
        registry = new ProofBatchRegistryV1(owner, publisher, 0);
    }

    function _load(string memory name) internal view returns (string memory) {
        string memory path = string.concat(vm.projectRoot(), "/../specs/canonical-vectors/", name);
        return vm.readFile(path);
    }

    function _batch(
        uint64 sequence,
        bytes32 previousBatchRoot,
        bytes32 globalRoot,
        bytes32 dataManifestHash,
        uint64 createdAt
    ) internal pure returns (ProofBatchRegistryV1.ProofBatch memory) {
        return ProofBatchRegistryV1.ProofBatch({
            sequence: sequence,
            previousBatchRoot: previousBatchRoot,
            globalRoot: globalRoot,
            dataManifestHash: dataManifestHash,
            createdAt: createdAt
        });
    }

    function _register(ProofBatchRegistryV1.ProofBatch memory batch) internal returns (bytes32) {
        vm.prank(publisher);
        return registry.registerBatch(batch);
    }

    /// @dev Seed sequences 0..n-1 so that the last globalRoot equals `tailRoot`.
    function _seedThrough(uint64 n, bytes32 tailRoot) internal {
        bytes32 prev = bytes32(0);
        for (uint64 i = 0; i < n; i++) {
            bytes32 root = (i == n - 1) ? tailRoot : keccak256(abi.encode("seed-root", i));
            _register(_batch(i, prev, root, keccak256(abi.encode("manifest", i)), uint64(1_000 + i)));
            prev = root;
        }
    }

    // -------------------------------------------------------------------------
    // Domain / vector 13 digests
    // -------------------------------------------------------------------------

    function test_domainConstant() public view {
        assertEq(registry.DOMAIN_PROOF_BATCH_V1(), keccak256("MOZETTO_PROOF_BATCH_V1"));
        string memory domains = _load("_domains.json");
        assertEq(registry.DOMAIN_PROOF_BATCH_V1(), domains.readBytes32(".PROOF_BATCH_V1"));
    }

    function test_vector13_globalRootAndProofBatchHash() public view {
        string memory j = _load("13_proof_batch_root.json");
        string memory p = ".expectedDecodedStructure";

        bytes32[] memory checkpoints = new bytes32[](3);
        checkpoints[0] = j.readBytes32(".checkpointRoots[0]");
        checkpoints[1] = j.readBytes32(".checkpointRoots[1]");
        checkpoints[2] = j.readBytes32(".checkpointRoots[2]");
        assertEq(registry.computeGlobalRoot(checkpoints), j.readBytes32(".globalRoot"));

        // Permuting leaf order MUST change globalRoot (vector expectedFailureMutations).
        bytes32[] memory permuted = new bytes32[](3);
        permuted[0] = checkpoints[1];
        permuted[1] = checkpoints[0];
        permuted[2] = checkpoints[2];
        assertTrue(registry.computeGlobalRoot(permuted) != j.readBytes32(".globalRoot"));

        ProofBatchRegistryV1.ProofBatch memory batch = _batch(
            uint64(j.readUint(string.concat(p, ".sequence"))),
            j.readBytes32(string.concat(p, ".previousBatchRoot")),
            j.readBytes32(string.concat(p, ".globalRoot")),
            j.readBytes32(string.concat(p, ".dataManifestHash")),
            uint64(j.readUint(string.concat(p, ".createdAt")))
        );
        assertEq(registry.computeProofBatchHash(batch), j.readBytes32(".keccak256"));
    }

    function test_vector13_registerWithContinuity() public {
        string memory j = _load("13_proof_batch_root.json");
        string memory p = ".expectedDecodedStructure";

        bytes32 previousBatchRoot = j.readBytes32(string.concat(p, ".previousBatchRoot"));
        _seedThrough(7, previousBatchRoot);

        ProofBatchRegistryV1.ProofBatch memory batch = _batch(
            7,
            previousBatchRoot,
            j.readBytes32(string.concat(p, ".globalRoot")),
            j.readBytes32(string.concat(p, ".dataManifestHash")),
            uint64(j.readUint(string.concat(p, ".createdAt")))
        );

        bytes32 expectedHash = j.readBytes32(".keccak256");
        vm.expectEmit(true, true, true, true);
        emit ProofBatchRegistryV1.ProofBatchRegistered(
            7,
            batch.globalRoot,
            batch.previousBatchRoot,
            batch.dataManifestHash,
            expectedHash,
            batch.createdAt,
            publisher
        );
        bytes32 h = _register(batch);
        assertEq(h, expectedHash);
        assertEq(registry.proofBatchHashes(7), expectedHash);
        assertEq(registry.nextSequence(), 8);
        assertEq(registry.latestSequence(), 7);

        ProofBatchRegistryV1.ProofBatch memory stored = registry.getBatch(7);
        assertEq(stored.globalRoot, batch.globalRoot);
        assertEq(stored.previousBatchRoot, previousBatchRoot);
        assertEq(stored.dataManifestHash, batch.dataManifestHash);
        assertEq(stored.createdAt, batch.createdAt);
    }

    // -------------------------------------------------------------------------
    // Happy path / continuity
    // -------------------------------------------------------------------------

    function test_registerSequence0_requiresZeroPrevious() public {
        bytes32 root = keccak256("g0");
        bytes32 h = _register(_batch(0, bytes32(0), root, keccak256("m0"), 100));
        assertEq(h, registry.proofBatchHashes(0));
        assertEq(registry.nextSequence(), 1);
        assertTrue(registry.usedGlobalRoots(root));
        assertTrue(registry.hasBatches());
    }

    function test_registerSequence0_rejectsNonZeroPrevious() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                ProofBatchRegistryV1.ContinuityBroken.selector, bytes32(0), keccak256("x")
            )
        );
        _register(_batch(0, keccak256("x"), keccak256("g0"), keccak256("m0"), 100));
    }

    function test_registerChain_previousEqualsPriorGlobalRoot() public {
        bytes32 r0 = keccak256("g0");
        bytes32 r1 = keccak256("g1");
        _register(_batch(0, bytes32(0), r0, keccak256("m0"), 100));
        bytes32 h1 = _register(_batch(1, r0, r1, keccak256("m1"), 101));
        assertEq(registry.getBatch(1).previousBatchRoot, r0);
        assertEq(registry.proofBatchHashes(1), h1);
    }

    // -------------------------------------------------------------------------
    // Rejections (vector mutations + policy)
    // -------------------------------------------------------------------------

    function test_rejectUnauthorizedPublisher() public {
        vm.prank(stranger);
        vm.expectRevert(ProofBatchRegistryV1.Unauthorized.selector);
        registry.registerBatch(_batch(0, bytes32(0), keccak256("g0"), keccak256("m0"), 100));
    }

    function test_rejectSequenceGap() public {
        vm.expectRevert(abi.encodeWithSelector(ProofBatchRegistryV1.InvalidSequence.selector, 0, 1));
        _register(_batch(1, bytes32(0), keccak256("g1"), keccak256("m1"), 100));
    }

    function test_rejectSequenceRegression() public {
        _register(_batch(0, bytes32(0), keccak256("g0"), keccak256("m0"), 100));
        vm.expectRevert(abi.encodeWithSelector(ProofBatchRegistryV1.InvalidSequence.selector, 1, 0));
        _register(_batch(0, bytes32(0), keccak256("g0b"), keccak256("m0b"), 101));
    }

    function test_rejectDuplicateSequence() public {
        _register(_batch(0, bytes32(0), keccak256("g0"), keccak256("m0"), 100));
        // Attempt to re-register sequence 0 after advancing — fails as gap/regression vs next=1
        vm.expectRevert(abi.encodeWithSelector(ProofBatchRegistryV1.InvalidSequence.selector, 1, 0));
        _register(_batch(0, bytes32(0), keccak256("g0-dup"), keccak256("m0"), 100));
    }

    function test_rejectWrongPreviousRoot_continuity() public {
        // Vector mutation: sequence 7 with previousBatchRoot of sequence 5
        string memory j = _load("13_proof_batch_root.json");
        bytes32 prev7 = j.readBytes32(".expectedDecodedStructure.previousBatchRoot");
        _seedThrough(7, prev7);

        bytes32 wrongPrev = registry.getBatch(5).globalRoot;
        vm.expectRevert(
            abi.encodeWithSelector(ProofBatchRegistryV1.ContinuityBroken.selector, prev7, wrongPrev)
        );
        _register(
            _batch(
                7,
                wrongPrev,
                j.readBytes32(".expectedDecodedStructure.globalRoot"),
                j.readBytes32(".expectedDecodedStructure.dataManifestHash"),
                uint64(j.readUint(".expectedDecodedStructure.createdAt"))
            )
        );
    }

    function test_rejectDuplicateGlobalRoot() public {
        bytes32 root = keccak256("same-root");
        _register(_batch(0, bytes32(0), root, keccak256("m0"), 100));
        vm.expectRevert(abi.encodeWithSelector(ProofBatchRegistryV1.DuplicateGlobalRoot.selector, root));
        _register(_batch(1, root, root, keccak256("m1"), 101));
    }

    function test_rejectZeroGlobalRoot() public {
        vm.expectRevert(ProofBatchRegistryV1.ZeroGlobalRoot.selector);
        _register(_batch(0, bytes32(0), bytes32(0), keccak256("m0"), 100));
    }

    // -------------------------------------------------------------------------
    // Publisher governance timelock
    // -------------------------------------------------------------------------

    function test_publisherTimelock_replace() public {
        registry.setMinDelay(1 days);
        registry.schedulePublisherUpdate(newPublisher);
        vm.expectRevert(
            abi.encodeWithSelector(
                ProofBatchRegistryV1.TimelockNotReady.selector, uint64(block.timestamp + 1 days)
            )
        );
        registry.executePublisherUpdate();

        vm.warp(block.timestamp + 1 days);
        registry.executePublisherUpdate();
        assertEq(registry.publisher(), newPublisher);

        // Old publisher unauthorized
        vm.prank(publisher);
        vm.expectRevert(ProofBatchRegistryV1.Unauthorized.selector);
        registry.registerBatch(_batch(0, bytes32(0), keccak256("g0"), keccak256("m0"), 100));

        vm.prank(newPublisher);
        registry.registerBatch(_batch(0, bytes32(0), keccak256("g0"), keccak256("m0"), 100));
        assertEq(registry.nextSequence(), 1);
    }

    function test_publisherTimelock_cancel() public {
        registry.schedulePublisherUpdate(newPublisher);
        registry.cancelPublisherUpdate();
        vm.expectRevert(ProofBatchRegistryV1.NoPendingOperation.selector);
        registry.executePublisherUpdate();
        assertEq(registry.publisher(), publisher);
    }

    function test_publisherTimelock_rejectsSecondSchedule() public {
        registry.schedulePublisherUpdate(newPublisher);
        vm.expectRevert(ProofBatchRegistryV1.OperationPending.selector);
        registry.schedulePublisherUpdate(address(0xABC));
    }

    function test_latestSequence_revertsWhenEmpty() public {
        vm.expectRevert(
            abi.encodeWithSelector(ProofBatchRegistryV1.InvalidSequence.selector, 0, type(uint64).max)
        );
        registry.latestSequence();
    }
}
