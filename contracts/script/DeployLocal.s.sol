// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {ArenaVaultV1} from "../src/ArenaVaultV1.sol";
import {TableRegistryV1} from "../src/TableRegistryV1.sol";
import {PokerSettlementHubV1} from "../src/PokerSettlementHubV1.sol";
import {CheckpointRegistryV1} from "../src/CheckpointRegistryV1.sol";
import {RandomnessCoordinatorV1} from "../src/RandomnessCoordinatorV1.sol";

/// @dev Local Anvil deploy — always deploys mintable mUSDC + protocol stack.
contract DeployLocal is Script {
    bytes32 internal constant NLHE_HU_STANDARD_V1 = keccak256("NLHE_HU_STANDARD_V1");

    function run() external {
        uint256 pk = vm.envOr("PRIVATE_KEY", uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80));
        address deployer = vm.addr(pk);
        address treasury = vm.envOr("FEE_TREASURY", deployer);

        vm.startBroadcast(pk);

        // Always deploy fresh MockUSDC on Anvil (ignore stale USDC_ADDRESS).
        MockUSDC usdc = new MockUSDC(deployer);
        // Unlimited local faucet.
        usdc.setFaucetPolicy(type(uint256).max, 0, type(uint256).max);
        usdc.mint(deployer, 100_000_000e6);

        ArenaVaultV1 vault = new ArenaVaultV1(address(usdc), treasury, deployer);
        PokerSettlementHubV1 hub = new PokerSettlementHubV1(address(vault), deployer);
        vault.setSettlementHub(address(hub));
        vault.setSessionRelayer(deployer);

        TableRegistryV1 registry = new TableRegistryV1(deployer);
        CheckpointRegistryV1 checkpoints = new CheckpointRegistryV1(deployer);
        RandomnessCoordinatorV1 randomness = new RandomnessCoordinatorV1(deployer);

        // Distinct Anvil attestors so 2-of-N quorum works with GAME/REPLAY/DEALER keys.
        // #0 deployer (relayer), #1 game, #7 replay, #8 dealer.
        hub.setAttestor(deployer, true);
        hub.setAttestor(0x70997970C51812dc3A010C7d01b50e0d17dc79C8, true);
        hub.setAttestor(0x14dC79964da2C08b23698B3D3cc7Ca32193d9955, true);
        hub.setAttestor(0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f, true);
        hub.setMinSignatures(2);

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

        console2.log("MockUSDC", address(usdc));
        console2.log("ArenaVaultV1", address(vault));
        console2.log("PokerSettlementHubV1", address(hub));
        console2.log("TableRegistryV1", address(registry));
        console2.log("CheckpointRegistryV1", address(checkpoints));
        console2.log("RandomnessCoordinatorV1", address(randomness));
        console2.log("FeeTreasury", treasury);

        vm.stopBroadcast();

        string memory json = string.concat(
            "{\n",
            '  "chainId": 31337,\n',
            '  "usdc": "', vm.toString(address(usdc)), '",\n',
            '  "symbol": "mUSDC",\n',
            '  "decimals": 6,\n',
            '  "isTestAsset": true,\n',
            '  "faucetEnabled": true,\n',
            '  "arenaVault": "', vm.toString(address(vault)), '",\n',
            '  "tableRegistry": "', vm.toString(address(registry)), '",\n',
            '  "settlementHub": "', vm.toString(address(hub)), '",\n',
            '  "checkpointRegistry": "', vm.toString(address(checkpoints)), '",\n',
            '  "randomnessCoordinator": "', vm.toString(address(randomness)), '",\n',
            '  "feeTreasury": "', vm.toString(treasury), '",\n',
            '  "deploymentBlock": ', vm.toString(block.number), ",\n",
            '  "protocolVersion": "1.0.0-anvil"\n',
            "}"
        );
        vm.writeFile("../packages/chain-manifest/deployments/anvil.json", json);
    }
}
