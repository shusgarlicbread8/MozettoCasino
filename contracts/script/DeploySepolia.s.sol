// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {ArenaVaultV1} from "../src/ArenaVaultV1.sol";
import {ArenaAccount} from "../src/ArenaAccount.sol";
import {ArenaAccountFactory} from "../src/ArenaAccountFactory.sol";
import {ArenaVaultV2} from "../src/ArenaVaultV2.sol";
import {TableRegistryV1} from "../src/TableRegistryV1.sol";
import {PokerSettlementHubV1} from "../src/PokerSettlementHubV1.sol";
import {PokerSettlementHubV2} from "../src/PokerSettlementHubV2.sol";
import {CheckpointRegistryV1} from "../src/CheckpointRegistryV1.sol";
import {RandomnessCoordinatorV1} from "../src/RandomnessCoordinatorV1.sol";

/// @dev Base Sepolia — Circle USDC by default; set USE_MOCK_USDC=1 for mintable mUSDC.
contract DeploySepolia is Script {
    address constant CIRCLE_USDC_SEPOLIA = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;
    bytes32 internal constant NLHE_HU_STANDARD_V1 = keccak256("NLHE_HU_STANDARD_V1");

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address treasury = vm.envOr("FEE_TREASURY_ADDRESS", deployer);
        bool useMock = vm.envOr("USE_MOCK_USDC", false);

        vm.startBroadcast(pk);

        address usdc;
        bool isTestAsset = false;
        bool faucetEnabled = false;
        string memory symbol = "USDC";

        if (useMock) {
            MockUSDC mock = new MockUSDC(deployer);
            mock.setFaucetPolicy(100_000e6, 10 minutes, 1_000_000e6);
            mock.mint(deployer, 10_000_000e6);
            usdc = address(mock);
            isTestAsset = true;
            faucetEnabled = true;
            symbol = "mUSDC";
            console2.log("MockUSDC (Sepolia staging)", usdc);
        } else {
            usdc = vm.envOr("USDC_ADDRESS", CIRCLE_USDC_SEPOLIA);
            console2.log("Circle USDC", usdc);
        }

        ArenaVaultV1 vaultV1 = new ArenaVaultV1(usdc, treasury, deployer);
        PokerSettlementHubV1 hubV1 = new PokerSettlementHubV1(address(vaultV1), deployer);
        vaultV1.setSettlementHub(address(hubV1));
        vaultV1.setSessionRelayer(deployer);

        ArenaAccount accountImpl = new ArenaAccount();
        ArenaAccountFactory factory = new ArenaAccountFactory(address(accountImpl), deployer);
        ArenaVaultV2 vault = new ArenaVaultV2(usdc, address(factory), treasury, deployer);
        PokerSettlementHubV2 hub = new PokerSettlementHubV2(address(vault), deployer);
        vault.setSettlementHub(address(hub));
        vault.setSessionRelayer(deployer);

        TableRegistryV1 registry = new TableRegistryV1(deployer);
        CheckpointRegistryV1 checkpoints = new CheckpointRegistryV1(deployer);
        RandomnessCoordinatorV1 randomness = new RandomnessCoordinatorV1(deployer);

        hub.setAttestor(deployer, true);
        hub.setMinSignatures(1);
        hubV1.setAttestor(deployer, true);
        hubV1.setMinSignatures(1);

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

        console2.log("ArenaAccountFactory", address(factory));
        console2.log("ArenaVaultV2", address(vault));
        console2.log("PokerSettlementHubV2", address(hub));
        console2.log("ArenaVaultV1", address(vaultV1));
        console2.log("TableRegistryV1", address(registry));
        console2.log("CheckpointRegistryV1", address(checkpoints));
        console2.log("RandomnessCoordinatorV1", address(randomness));
        console2.log("FeeTreasury", treasury);

        vm.stopBroadcast();

        string memory json = string.concat(
            "{\n",
            '  "chainId": 84532,\n',
            '  "usdc": "', vm.toString(usdc), '",\n',
            '  "symbol": "', symbol, '",\n',
            '  "decimals": 6,\n',
            '  "isTestAsset": ', isTestAsset ? "true" : "false", ",\n",
            '  "faucetEnabled": ', faucetEnabled ? "true" : "false", ",\n",
            '  "arenaVault": "', vm.toString(address(vault)), '",\n',
            '  "arenaVaultV1": "', vm.toString(address(vaultV1)), '",\n',
            '  "arenaAccountFactory": "', vm.toString(address(factory)), '",\n',
            '  "arenaAccountImplementation": "', vm.toString(address(accountImpl)), '",\n',
            '  "tableRegistry": "', vm.toString(address(registry)), '",\n',
            '  "settlementHub": "', vm.toString(address(hub)), '",\n',
            '  "settlementHubV1": "', vm.toString(address(hubV1)), '",\n',
            '  "checkpointRegistry": "', vm.toString(address(checkpoints)), '",\n',
            '  "randomnessCoordinator": "', vm.toString(address(randomness)), '",\n',
            '  "feeTreasury": "', vm.toString(treasury), '",\n',
            '  "deploymentBlock": ', vm.toString(block.number), ",\n",
            '  "protocolVersion": "2.0.0-sepolia"\n',
            "}"
        );
        vm.writeFile("../packages/chain-manifest/deployments/baseSepolia.json", json);
    }
}
