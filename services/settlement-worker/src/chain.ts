import { createHash } from "node:crypto";
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  toBytes,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia, foundry } from "viem/chains";

export function keccakLike(data: string): Hex {
  return (`0x${createHash("sha256").update(data).digest("hex")}`) as Hex;
}

/** Custody session ids are already bytes32 hex from openSession — do not re-hash. */
export function sessionIdToBytes32(sessionId: string): Hex {
  if (/^0x[0-9a-fA-F]{64}$/.test(sessionId)) return sessionId.toLowerCase() as Hex;
  const hex = sessionId.startsWith("0x") ? sessionId.slice(2) : sessionId;
  if (/^[0-9a-fA-F]{64}$/.test(hex)) return (`0x${hex.toLowerCase()}`) as Hex;
  return keccak256(toBytes(sessionId));
}

export function toBytes32(raw: string): Hex {
  const hex = raw.startsWith("0x") ? raw.slice(2) : raw;
  return (`0x${hex.padStart(64, "0").slice(-64)}`) as Hex;
}

export function chainClients(pk: Hex) {
  const chainId = Number(process.env.CHAIN_ID || 84532);
  const chain = chainId === 31337 ? foundry : baseSepolia;
  const rpc =
    chainId === 31337
      ? process.env.ANVIL_RPC_URL || "http://127.0.0.1:8545"
      : process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
  const account = privateKeyToAccount(pk);
  const wallet = createWalletClient({ account, chain, transport: http(rpc) });
  const publicClient = createPublicClient({ chain, transport: http(rpc) });
  return { chainId, chain, rpc, account, wallet, publicClient };
}

/** Resolve settlement hub mode: V3 when address/mode set, else legacy V2. */
export function resolveSettlementMode(
  env: NodeJS.ProcessEnv = process.env,
): { mode: "v3" | "v2"; hubAddress: Hex | undefined } {
  const forced = (env.SETTLEMENT_HUB_VERSION || env.SETTLEMENT_MODE || "").toLowerCase();
  const hubV3 = (env.SETTLEMENT_HUB_V3_ADDRESS || env.NEXT_PUBLIC_SETTLEMENT_HUB_V3_ADDRESS) as
    | Hex
    | undefined;
  const hubV2 = env.SETTLEMENT_HUB_ADDRESS as Hex | undefined;

  if (forced === "3" || forced === "v3") {
    return { mode: "v3", hubAddress: hubV3 ?? hubV2 };
  }
  if (forced === "2" || forced === "v2") {
    return { mode: "v2", hubAddress: hubV2 };
  }
  if (hubV3) {
    return { mode: "v3", hubAddress: hubV3 };
  }
  return { mode: "v2", hubAddress: hubV2 };
}
