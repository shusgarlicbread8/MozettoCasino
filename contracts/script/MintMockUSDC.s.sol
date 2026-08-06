// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

/// @dev Admin mint for arbitrary test wallets (requires MINTER_ROLE).
contract MintMockUSDC is Script {
    function run() external {
        uint256 minterKey = vm.envUint("MINTER_PRIVATE_KEY");
        address token = vm.envAddress("MOCK_USDC_ADDRESS");
        address recipient = vm.envAddress("RECIPIENT");
        uint256 amountUsdc = vm.envUint("AMOUNT_USDC");

        vm.startBroadcast(minterKey);
        MockUSDC(token).mint(recipient, amountUsdc * 1e6);
        vm.stopBroadcast();

        console2.log("Minted", amountUsdc, "mUSDC to", recipient);
    }
}
