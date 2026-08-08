// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {ArenaVaultV1} from "../src/ArenaVaultV1.sol";
import {ArenaAccount} from "../src/ArenaAccount.sol";
import {ArenaAccountFactory} from "../src/ArenaAccountFactory.sol";
import {ArenaVaultV2} from "../src/ArenaVaultV2.sol";
import {TableRegistryV1} from "../src/TableRegistryV1.sol";
import {GameRegistryV2} from "../src/GameRegistryV2.sol";
import {SessionLifecycleV2} from "../src/SessionLifecycleV2.sol";
import {ProtocolFeeVault} from "../src/ProtocolFeeVault.sol";
import {PokerSettlementHubV1} from "../src/PokerSettlementHubV1.sol";
import {PokerSettlementHubV2} from "../src/PokerSettlementHubV2.sol";
import {PokerSettlementHubV3} from "../src/PokerSettlementHubV3.sol";
import {SignatureQuorumVerifier} from "../src/SignatureQuorumVerifier.sol";
import {VerifierRouter} from "../src/VerifierRouter.sol";
import {CheckpointRegistryV1} from "../src/CheckpointRegistryV1.sol";
import {RandomnessCoordinatorV1} from "../src/RandomnessCoordinatorV1.sol";
import {RandomnessBeaconV2} from "../src/RandomnessBeaconV2.sol";
import {ProofBatchRegistryV1} from "../src/ProofBatchRegistryV1.sol";
import {CityTemplates} from "./CityTemplates.sol";

/// @title DeploySepolia — Base Sepolia V3 stack (WP-102)
/// @dev Circle USDC by default; set USE_MOCK_USDC=1 for mintable mUSDC staging.
///      Writes packages/chain-manifest/deployments/baseSepolia.json then run
///      `pnpm --filter chain-manifest codegen` (package name @ mozetto / chain-manifest).
///      Chainlink VRF adapter is separate: DeployChainlinkVrfAdapter.s.sol (WP-053).
contract DeploySepolia is Script {
    address constant CIRCLE_USDC_SEPOLIA = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;
    address constant BASE_SEPOLIA_VRF_COORDINATOR = 0x5C210eF41CD1a72de73bF76eC39637bB0d3d7BEE;
    bytes32 constant BASE_SEPOLIA_VRF_KEY_HASH =
        0x9e1344a1247c8a1785d0a4681a27152bffdb43666ae5bf7d14d24a5efd44bf71;

    bytes32 internal constant NLHE_HU_STANDARD_V1 = keccak256("NLHE_HU_STANDARD_V1");

    struct Core {
        address usdc;
        bool isTestAsset;
        bool faucetEnabled;
        string symbol;
        ArenaAccount accountImpl;
        ArenaAccountFactory factory;
        ArenaVaultV2 vault;
        ArenaVaultV1 vaultV1;
        ProtocolFeeVault feeVault;
        PokerSettlementHubV1 hubV1;
        PokerSettlementHubV2 hub;
        PokerSettlementHubV3 hubV3;
        VerifierRouter verifierRouter;
        SignatureQuorumVerifier quorum;
        bool hubV3Primary;
    }

    struct Aux {
        TableRegistryV1 registry;
        GameRegistryV2 gameRegistry;
        SessionLifecycleV2 sessionLifecycle;
        CheckpointRegistryV1 checkpoints;
        RandomnessCoordinatorV1 randomness;
        RandomnessBeaconV2 beacon;
        ProofBatchRegistryV1 proofBatchRegistry;
        address treasury;
    }

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address treasury = vm.envOr("FEE_TREASURY_ADDRESS", deployer);

        vm.startBroadcast(pk);
        Core memory core = _deployCore(deployer, treasury);
        Aux memory aux = _deployAux(deployer, treasury, core);
        _configureAttestors(deployer, core);
        _seedTemplates(aux.registry, aux.gameRegistry);
        vm.stopBroadcast();

        _log(core, aux);
        // Only persist addresses after a real broadcast (prevents dry-run simulated addrs).
        if (vm.envOr("WRITE_CHAIN_MANIFEST", false)) {
            _writeManifest(core, aux);
        } else {
            console2.log("Skipped manifest write (set WRITE_CHAIN_MANIFEST=1 with --broadcast)");
        }
    }

    function _deployCore(address deployer, address treasury) internal returns (Core memory c) {
        bool useMock = vm.envOr("USE_MOCK_USDC", false);
        uint64 feeVaultMinDelay = uint64(vm.envOr("PROTOCOL_FEE_VAULT_MIN_DELAY", uint256(1 days)));

        if (useMock) {
            MockUSDC mock = new MockUSDC(deployer);
            mock.setFaucetPolicy(100_000e6, 10 minutes, 1_000_000e6);
            mock.mint(deployer, 10_000_000e6);
            c.usdc = address(mock);
            c.isTestAsset = true;
            c.faucetEnabled = true;
            c.symbol = "mUSDC";
            console2.log("MockUSDC (Sepolia staging)", c.usdc);
        } else {
            c.usdc = vm.envOr("USDC_ADDRESS", CIRCLE_USDC_SEPOLIA);
            c.isTestAsset = false;
            c.faucetEnabled = false;
            c.symbol = "USDC";
            console2.log("Circle USDC", c.usdc);
        }

        c.vaultV1 = new ArenaVaultV1(c.usdc, treasury, deployer);
        c.hubV1 = new PokerSettlementHubV1(address(c.vaultV1), deployer);
        c.vaultV1.setSettlementHub(address(c.hubV1));
        c.vaultV1.setSessionRelayer(deployer);

        c.feeVault = new ProtocolFeeVault(c.usdc, treasury, deployer, deployer, feeVaultMinDelay);

        c.accountImpl = new ArenaAccount();
        c.factory = new ArenaAccountFactory(address(c.accountImpl), deployer);
        c.vault = new ArenaVaultV2(c.usdc, address(c.factory), address(c.feeVault), deployer);
        c.feeVault.setDepositor(address(c.vault), true);
        c.hub = new PokerSettlementHubV2(address(c.vault), deployer);

        // WP-063: Hub V3 additive; V2 remains vault settlementHub unless SETTLEMENT_HUB_V3_AS_PRIMARY=1.
        c.quorum = new SignatureQuorumVerifier(deployer);
        c.verifierRouter = new VerifierRouter(deployer);
        c.hubV3 = new PokerSettlementHubV3(address(c.vault), address(c.verifierRouter), deployer);
        c.verifierRouter.setVerifier(c.hubV3.SEASON1_QUORUM_POLICY(), address(c.quorum));
        c.verifierRouter.setDefaultPolicyId(c.hubV3.SEASON1_QUORUM_POLICY());

        c.hubV3Primary = vm.envOr("SETTLEMENT_HUB_V3_AS_PRIMARY", false);
        if (c.hubV3Primary) {
            c.vault.setSettlementHub(address(c.hubV3));
        } else {
            c.vault.setSettlementHub(address(c.hub));
        }
        c.vault.setSessionRelayer(deployer);
    }

    function _deployAux(address deployer, address treasury, Core memory core) internal returns (Aux memory a) {
        a.treasury = treasury;
        a.registry = new TableRegistryV1(deployer);

        // Staging seed uses delay 0 so templates can activate in-script; raise via owner post-deploy.
        uint64 gameRegistryMinDelay = uint64(vm.envOr("GAME_REGISTRY_MIN_DELAY", uint256(0)));
        a.gameRegistry = new GameRegistryV2(deployer, deployer, gameRegistryMinDelay);
        a.sessionLifecycle = new SessionLifecycleV2(deployer);
        a.checkpoints = new CheckpointRegistryV1(deployer);
        a.randomness = new RandomnessCoordinatorV1(deployer);

        // WP-050 / WP-053: mock off by default; Chainlink adapter deployed separately.
        bool beaconMock = vm.envOr("ENABLE_MOCK_VRF", false);
        a.beacon = new RandomnessBeaconV2(deployer, beaconMock);
        a.beacon.setOperator(deployer);

        uint64 proofBatchMinDelay = uint64(vm.envOr("PROOF_BATCH_REGISTRY_MIN_DELAY", uint256(1 days)));
        a.proofBatchRegistry = new ProofBatchRegistryV1(deployer, deployer, proofBatchMinDelay);
        core.hubV3.setProofBatchRegistry(address(a.proofBatchRegistry), false);

        a.sessionLifecycle.setVault(address(core.vault));
        a.sessionLifecycle.setSessionRelayer(deployer);
        a.sessionLifecycle.setGameRegistry(address(a.gameRegistry));
        core.vault.setSessionLifecycle(address(a.sessionLifecycle));
        core.vault.setGameRegistry(address(a.gameRegistry));
    }

    function _configureAttestors(address deployer, Core memory c) internal {
        // Staging default: deployer-only 1-of-1. Ops should register distinct attestors and raise
        // minSignatures toward 3-of-N before WP-103 public test (Plan 10).
        c.hub.setAttestor(deployer, true);
        c.hub.setMinSignatures(1);
        c.quorum.setAttestor(deployer, true);
        c.quorum.setMinSignatures(1);
        c.hubV1.setAttestor(deployer, true);
        c.hubV1.setMinSignatures(1);

        address a1 = vm.envOr("ATTESTOR_1_ADDRESS", address(0));
        address a2 = vm.envOr("ATTESTOR_2_ADDRESS", address(0));
        address a3 = vm.envOr("ATTESTOR_3_ADDRESS", address(0));
        uint256 minSig = vm.envOr("ATTESTOR_MIN_SIGNATURES", uint256(1));
        if (a1 != address(0)) {
            c.hub.setAttestor(a1, true);
            c.quorum.setAttestor(a1, true);
            c.hubV1.setAttestor(a1, true);
        }
        if (a2 != address(0)) {
            c.hub.setAttestor(a2, true);
            c.quorum.setAttestor(a2, true);
            c.hubV1.setAttestor(a2, true);
        }
        if (a3 != address(0)) {
            c.hub.setAttestor(a3, true);
            c.quorum.setAttestor(a3, true);
            c.hubV1.setAttestor(a3, true);
        }
        if (minSig > 1) {
            c.hub.setMinSignatures(uint8(minSig));
            c.quorum.setMinSignatures(uint8(minSig));
            c.hubV1.setMinSignatures(uint8(minSig));
        }
    }

    function _seedTemplates(TableRegistryV1 registry, GameRegistryV2 gameRegistry) internal {
        registry.registerTemplate(
            NLHE_HU_STANDARD_V1,
            TableRegistryV1.GameTemplate({
                gameId: keccak256("NLHE_HU"),
                minSeats: 2,
                maxSeats: 2,
                actionClockMs: 30_000,
                rakeBps: 250,
                rakeCap: 500e6,
                minimumBuyIn: 100e6,
                maximumBuyIn: 10_000e6,
                engineHash: keccak256("poker-engine-v1"),
                rulesHash: keccak256("nlhe-hu-rules-v1"),
                profileSetHash: keccak256("profile-set-v1"),
                rated: true,
                enabled: true
            })
        );
        _seedGameRegistryV2(gameRegistry);
    }

    /// @dev Registers the legacy fixed-id pair plus one HU template per city and six-max
    ///      for Berlin/London. See `CityTemplates` for the id naming rule. In-script
    ///      activation only works while GAME_REGISTRY_MIN_DELAY is 0; with a real delay,
    ///      templates land Registered and ops executes activation after the timelock.
    function _seedGameRegistryV2(GameRegistryV2 gameRegistry) internal {
        _registerAndActivate(gameRegistry, CityTemplates.standardTemplate(gameRegistry.NLHE_HU_STANDARD_V2(), 2));
        _registerAndActivate(
            gameRegistry, CityTemplates.standardTemplate(gameRegistry.NLHE_SIXMAX_STANDARD_V2(), 6)
        );

        CityTemplates.City[] memory cities = CityTemplates.cities();
        for (uint256 i = 0; i < cities.length; i++) {
            _registerAndActivate(gameRegistry, CityTemplates.huTemplate(cities[i]));
        }
        _registerAndActivate(gameRegistry, CityTemplates.sixMaxTemplate(cities[1]));
        _registerAndActivate(gameRegistry, CityTemplates.sixMaxTemplate(cities[2]));
    }

    function _registerAndActivate(GameRegistryV2 gameRegistry, GameRegistryV2.GameTemplateV2 memory body)
        internal
    {
        gameRegistry.registerTemplate(body);
        gameRegistry.scheduleActivation(body.templateId);
        if (gameRegistry.minDelay() == 0) {
            gameRegistry.executeActivation(body.templateId);
        }
    }

    function _log(Core memory c, Aux memory a) internal view {
        console2.log("ArenaAccountImplementation", address(c.accountImpl));
        console2.log("ArenaAccountFactory", address(c.factory));
        console2.log("ArenaVaultV2", address(c.vault));
        console2.log("PokerSettlementHubV2", address(c.hub));
        console2.log("PokerSettlementHubV3", address(c.hubV3));
        console2.log("VerifierRouter", address(c.verifierRouter));
        console2.log("SignatureQuorumVerifier", address(c.quorum));
        console2.log("ArenaVaultV1", address(c.vaultV1));
        console2.log("PokerSettlementHubV1", address(c.hubV1));
        console2.log("TableRegistryV1", address(a.registry));
        console2.log("GameRegistryV2", address(a.gameRegistry));
        console2.log("SessionLifecycleV2", address(a.sessionLifecycle));
        console2.log("ProtocolFeeVault", address(c.feeVault));
        console2.log("CheckpointRegistryV1", address(a.checkpoints));
        console2.log("RandomnessCoordinatorV1", address(a.randomness));
        console2.log("RandomnessBeaconV2", address(a.beacon));
        console2.log("ProofBatchRegistryV1", address(a.proofBatchRegistry));
        console2.log("FeeTreasury", a.treasury);
        console2.log("settlementHubPrimaryIsV3", c.hubV3Primary);
        console2.log("Next: DeployChainlinkVrfAdapter.s.sol after funded VRF subscription");
    }

    function _writeManifest(Core memory c, Aux memory a) internal {
        address settlementHub = c.hubV3Primary ? address(c.hubV3) : address(c.hub);
        string memory json = string.concat(
            "{\n",
            '  "chainId": 84532,\n',
            '  "usdc": "',
            vm.toString(c.usdc),
            '",\n',
            '  "symbol": "',
            c.symbol,
            '",\n',
            '  "decimals": 6,\n',
            '  "isTestAsset": ',
            c.isTestAsset ? "true" : "false",
            ",\n",
            '  "faucetEnabled": ',
            c.faucetEnabled ? "true" : "false",
            ",\n",
            '  "arenaVault": "',
            vm.toString(address(c.vault)),
            '",\n',
            '  "arenaVaultV1": "',
            vm.toString(address(c.vaultV1)),
            '",\n',
            '  "arenaAccountFactory": "',
            vm.toString(address(c.factory)),
            '",\n',
            '  "arenaAccountImplementation": "',
            vm.toString(address(c.accountImpl)),
            '",\n',
            '  "tableRegistry": "',
            vm.toString(address(a.registry)),
            '",\n',
            '  "gameRegistry": "',
            vm.toString(address(a.gameRegistry)),
            '",\n',
            '  "sessionLifecycle": "',
            vm.toString(address(a.sessionLifecycle)),
            '",\n',
            '  "protocolFeeVault": "',
            vm.toString(address(c.feeVault)),
            '",\n',
            '  "settlementHub": "',
            vm.toString(settlementHub),
            '",\n',
            '  "settlementHubV1": "',
            vm.toString(address(c.hubV1)),
            '",\n',
            '  "settlementHubV2": "',
            vm.toString(address(c.hub)),
            '",\n',
            '  "settlementHubV3": "',
            vm.toString(address(c.hubV3)),
            '",\n',
            '  "verifierRouter": "',
            vm.toString(address(c.verifierRouter)),
            '",\n',
            '  "signatureQuorumVerifier": "',
            vm.toString(address(c.quorum)),
            '",\n',
            '  "checkpointRegistry": "',
            vm.toString(address(a.checkpoints)),
            '",\n',
            '  "randomnessCoordinator": "',
            vm.toString(address(a.randomness)),
            '",\n',
            '  "randomnessBeacon": "',
            vm.toString(address(a.beacon)),
            '",\n',
            '  "chainlinkVrfAdapter": null,\n',
            '  "proofBatchRegistry": "',
            vm.toString(address(a.proofBatchRegistry)),
            '",\n',
            '  "feeTreasury": "',
            vm.toString(a.treasury),
            '",\n',
            '  "deploymentBlock": ',
            vm.toString(block.number),
            ",\n",
            '  "protocolVersion": "2.0.0-sepolia",\n',
            '  "vrfCoordinator": "',
            vm.toString(BASE_SEPOLIA_VRF_COORDINATOR),
            '",\n',
            '  "vrfKeyHash": "',
            vm.toString(BASE_SEPOLIA_VRF_KEY_HASH),
            '"\n',
            "}"
        );
        vm.writeFile("../packages/chain-manifest/deployments/baseSepolia.json", json);
        console2.log("Wrote packages/chain-manifest/deployments/baseSepolia.json");
        console2.log("Run: pnpm --filter @mozetto/chain-manifest codegen");
    }
}
