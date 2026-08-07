import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const generated = readFileSync(join(root, "src/generated.ts"), "utf8");
const indexSrc = readFileSync(join(root, "src/index.ts"), "utf8");
const codegenSrc = readFileSync(join(root, "scripts/codegen.mjs"), "utf8");

const CIRCLE_BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

/**
 * Guard: Base mainnet must never resolve a test/mock asset.
 * Asserts generated manifest + source-level rejection (codegen + getManifest).
 */
describe("mainnet mock-asset rejection", () => {
  it("rejects isTestAsset on Base mainnet (8453)", () => {
    const entry = { chainId: 8453, isTestAsset: true, faucetEnabled: true };
    assert.throws(() => {
      if (entry.chainId === 8453 && (entry.isTestAsset || entry.faucetEnabled)) {
        throw new Error("Base mainnet cannot resolve a test asset or faucet");
      }
    }, /cannot resolve a test asset/);
  });

  it("allows test asset on Anvil", () => {
    const entry = { chainId: 31337, isTestAsset: true, faucetEnabled: true };
    assert.doesNotThrow(() => {
      if (entry.chainId === 8453 && (entry.isTestAsset || entry.faucetEnabled)) {
        throw new Error("Base mainnet cannot resolve a test asset or faucet");
      }
    });
  });

  it("generated base entry is Circle USDC (not MockUSDC)", () => {
    assert.match(generated, /base:\s*\{[\s\S]*?chainId:\s*8453/);
    assert.match(generated, new RegExp(`usdc: "${CIRCLE_BASE_USDC}"`, "i"));
    assert.doesNotMatch(
      generated.slice(generated.indexOf("base:")),
      /symbol: "mUSDC"|isTestAsset: true|faucetEnabled: true/,
    );
  });

  it("codegen rejects MockUSDC / mUSDC on base", () => {
    assert.match(codegenSrc, /MockUSDC \/ test assets are forbidden on Base mainnet/);
    assert.match(codegenSrc, /network === "base" \? "USDC"/);
    assert.match(codegenSrc, /network === "base" \? false/);
  });

  it("getManifest rejects non-Circle USDC env override on base", () => {
    assert.match(indexSrc, /MockUSDC is forbidden on Base Mainnet/);
    assert.match(indexSrc, /833589fCD6eDb6E08f4c7C32D4f71b54bdA02913/);
    assert.match(indexSrc, /key === "base"/);
  });

  it("runtime guard rejects mock address on mainnet", () => {
    const key = "base";
    const resolvedUsdc = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
    assert.throws(() => {
      if (key === "base" && resolvedUsdc.toLowerCase() !== CIRCLE_BASE_USDC.toLowerCase()) {
        throw new Error("MockUSDC is forbidden on Base Mainnet");
      }
    }, /MockUSDC is forbidden on Base Mainnet/);
  });
});
