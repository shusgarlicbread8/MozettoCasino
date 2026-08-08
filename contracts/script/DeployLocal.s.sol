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

/// @dev Local Anvil deploy — mintable mUSDC + V1 (compat) + ArenaAccount V2 stack.
///      Helpers keep `run()` under the EVM stack limit (via-IR still stressed by many locals).
contract DeployLocal is Script {
    bytes32 internal constant NLHE_HU_STANDARD_V1 = keccak256("NLHE_HU_STANDARD_V1");

    struct Core {
        MockUSDC usdc;
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
        uint256 pk = vm.envOr("PRIVATE_KEY", uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80));
        address deployer = vm.addr(pk);
        address treasury = vm.envOr("FEE_TREASURY_ADDRESS", deployer);

        vm.startBroadcast(pk);
        Core memory core = _deployCore(deployer, treasury);
        Aux memory aux = _deployAux(deployer, treasury, core);
        _configureAttestors(deployer, core);
        _seedTemplates(aux.registry, aux.gameRegistry);
        vm.stopBroadcast();

        _log(core, aux);
        _writeManifest(core, aux);
    }

    function _deployCore(address deployer, address treasury) internal returns (Core memory c) {
        c.usdc = new MockUSDC(deployer);
        c.usdc.setFaucetPolicy(type(uint256).max, 0, type(uint256).max);
        c.usdc.mint(deployer, 100_000_000e6);

        c.vaultV1 = new ArenaVaultV1(address(c.usdc), treasury, deployer);
        c.hubV1 = new PokerSettlementHubV1(address(c.vaultV1), deployer);
        c.vaultV1.setSettlementHub(address(c.hubV1));
        c.vaultV1.setSessionRelayer(deployer);

        c.feeVault = new ProtocolFeeVault(address(c.usdc), treasury, deployer, deployer, 0);

        c.accountImpl = new ArenaAccount();
        c.factory = new ArenaAccountFactory(address(c.accountImpl), deployer);
        c.vault = new ArenaVaultV2(address(c.usdc), address(c.factory), address(c.feeVault), deployer);
        c.feeVault.setDepositor(address(c.vault), true);
        c.hub = new PokerSettlementHubV2(address(c.vault), deployer);

        // WP-063: Hub V3 + VerifierRouter additive; V2 remains vault settlementHub for demos
        // unless SETTLEMENT_HUB_V3_AS_PRIMARY=1.
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
        a.gameRegistry = new GameRegistryV2(deployer, deployer, 0);
        a.sessionLifecycle = new SessionLifecycleV2(deployer);
        a.checkpoints = new CheckpointRegistryV1(deployer);
        a.randomness = new RandomnessCoordinatorV1(deployer);
        a.beacon = new RandomnessBeaconV2(deployer, true);
        a.beacon.setOperator(deployer);
        // WP-062: global proof-batch registry; publisher = deployer, minDelay=0 for Anvil.
        a.proofBatchRegistry = new ProofBatchRegistryV1(deployer, deployer, 0);
        // Wire into Hub V3 (requireProofBatch=false so demos need not publish batches first).
        core.hubV3.setProofBatchRegistry(address(a.proofBatchRegistry), false);

        a.sessionLifecycle.setVault(address(core.vault));
        a.sessionLifecycle.setSessionRelayer(deployer);
        a.sessionLifecycle.setGameRegistry(address(a.gameRegistry));
        core.vault.setSessionLifecycle(address(a.sessionLifecycle));
        core.vault.setGameRegistry(address(a.gameRegistry));
    }

    function _configureAttestors(address deployer, Core memory c) internal {
        address a1 = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;
        address a2 = 0x14dC79964da2C08b23698B3D3cc7Ca32193d9955;
        address a3 = 0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f;

        c.hub.setAttestor(deployer, true);
        c.hub.setAttestor(a1, true);
        c.hub.setAttestor(a2, true);
        c.hub.setAttestor(a3, true);
        c.hub.setMinSignatures(2);

        c.quorum.setAttestor(deployer, true);
        c.quorum.setAttestor(a1, true);
        c.quorum.setAttestor(a2, true);
        c.quorum.setAttestor(a3, true);
        c.quorum.setMinSignatures(2);

        c.hubV1.setAttestor(deployer, true);
        c.hubV1.setAttestor(a1, true);
        c.hubV1.setAttestor(a2, true);
        c.hubV1.setAttestor(a3, true);
        c.hubV1.setMinSignatures(2);
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

    function _log(Core memory c, Aux memory a) internal view {
        console2.log("MockUSDC", address(c.usdc));
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
    }

    function _writeManifest(Core memory c, Aux memory a) internal {
        address settlementHub = c.hubV3Primary ? address(c.hubV3) : address(c.hub);
        string memory json = string.concat(
            "{\n",
            '  "chainId": 31337,\n',
            '  "usdc": "', vm.toString(address(c.usdc)), '",\n',
            '  "symbol": "mUSDC",\n',
            '  "decimals": 6,\n',
            '  "isTestAsset": true,\n',
            '  "faucetEnabled": true,\n',
            '  "arenaVault": "', vm.toString(address(c.vault)), '",\n',
            '  "arenaVaultV1": "', vm.toString(address(c.vaultV1)), '",\n',
            '  "arenaAccountFactory": "', vm.toString(address(c.factory)), '",\n',
            '  "arenaAccountImplementation": "', vm.toString(address(c.accountImpl)), '",\n',
            '  "tableRegistry": "', vm.toString(address(a.registry)), '",\n',
            '  "gameRegistry": "', vm.toString(address(a.gameRegistry)), '",\n',
            '  "sessionLifecycle": "', vm.toString(address(a.sessionLifecycle)), '",\n',
            '  "protocolFeeVault": "', vm.toString(address(c.feeVault)), '",\n',
            '  "settlementHub": "', vm.toString(settlementHub), '",\n',
            '  "settlementHubV1": "', vm.toString(address(c.hubV1)), '",\n',
            '  "settlementHubV2": "', vm.toString(address(c.hub)), '",\n',
            '  "settlementHubV3": "', vm.toString(address(c.hubV3)), '",\n',
            '  "verifierRouter": "', vm.toString(address(c.verifierRouter)), '",\n',
            '  "signatureQuorumVerifier": "', vm.toString(address(c.quorum)), '",\n',
            '  "checkpointRegistry": "', vm.toString(address(a.checkpoints)), '",\n',
            '  "randomnessCoordinator": "', vm.toString(address(a.randomness)), '",\n',
            '  "randomnessBeacon": "', vm.toString(address(a.beacon)), '",\n',
            '  "proofBatchRegistry": "', vm.toString(address(a.proofBatchRegistry)), '",\n',
            '  "feeTreasury": "', vm.toString(a.treasury), '",\n',
            '  "deploymentBlock": ', vm.toString(block.number), ",\n",
            '  "protocolVersion": "2.0.0-anvil"\n',
            "}"
        );
        vm.writeFile("../packages/chain-manifest/deployments/anvil.json", json);
    }

    /// @dev Registers the legacy fixed-id pair plus one HU template per city and six-max
    ///      for Berlin/London. See `CityTemplates` for the id naming rule.
    function _seedGameRegistryV2(GameRegistryV2 gameRegistry) internal {
        _registerAndActivate(gameRegistry, CityTemplates.standardTemplate(gameRegistry.NLHE_HU_STANDARD_V2(), 2));
        _registerAndActivate(
            gameRegistry, CityTemplates.standardTemplate(gameRegistry.NLHE_SIXMAX_STANDARD_V2(), 6)
        );

        CityTemplates.City[] memory cities = CityTemplates.cities();
        for (uint256 i = 0; i < cities.length; i++) {
            _registerAndActivate(gameRegistry, CityTemplates.huTemplate(cities[i]));
        }
        // Six-max opens at Berlin and London only; the deeper cities stay heads-up
        // until there is enough population to fill a six-handed table.
        _registerAndActivate(gameRegistry, CityTemplates.sixMaxTemplate(cities[1]));
        _registerAndActivate(gameRegistry, CityTemplates.sixMaxTemplate(cities[2]));
    }

    function _registerAndActivate(GameRegistryV2 gameRegistry, GameRegistryV2.GameTemplateV2 memory body)
        internal
    {
        gameRegistry.registerTemplate(body);
        gameRegistry.scheduleActivation(body.templateId);
        gameRegistry.executeActivation(body.templateId);
    }
}
