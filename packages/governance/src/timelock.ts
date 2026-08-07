import { type Address, type Hex, encodeFunctionData, keccak256, encodeAbiParameters, zeroHash } from "viem";
import { TIMELOCK_CONTROLLER_ABI } from "./abis.js";
import type { EncodedCall, TimelockScheduleParams } from "./types.js";

export const ZERO_PREDECESSOR = zeroHash;

/** Deterministic salt from action description + optional nonce. */
export function deriveTimelockSalt(label: string, nonce = 0): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "string" }, { type: "uint256" }],
      [label, BigInt(nonce)],
    ),
  );
}

export function buildTimelockScheduleCall(
  timelock: Address,
  params: TimelockScheduleParams,
): EncodedCall {
  return {
    actionId: "timelock.schedule",
    to: timelock,
    data: encodeFunctionData({
      abi: TIMELOCK_CONTROLLER_ABI,
      functionName: "schedule",
      args: [
        params.target,
        params.value,
        params.data,
        params.predecessor,
        params.salt,
        params.delay,
      ],
    }),
    value: "0",
    description: `TimelockController.schedule → ${params.target}`,
    contractTimelocked: true,
  };
}

export function buildTimelockExecuteCall(
  timelock: Address,
  params: Omit<TimelockScheduleParams, "delay">,
): EncodedCall {
  return {
    actionId: "timelock.execute",
    to: timelock,
    data: encodeFunctionData({
      abi: TIMELOCK_CONTROLLER_ABI,
      functionName: "execute",
      args: [params.target, params.value, params.data, params.predecessor, params.salt],
    }),
    value: "0",
    description: `TimelockController.execute → ${params.target}`,
    contractTimelocked: false,
  };
}

/**
 * Wrap an inner owner call as TimelockController.schedule so the Safe proposes
 * against the timelock (production: TimelockController owns the contracts).
 */
export function wrapWithTimelockSchedule(
  timelock: Address,
  inner: EncodedCall,
  delaySec: number,
  opts?: { salt?: Hex; predecessor?: Hex; nonce?: number },
): EncodedCall {
  const salt = opts?.salt ?? deriveTimelockSalt(inner.actionId, opts?.nonce ?? 0);
  const predecessor = opts?.predecessor ?? ZERO_PREDECESSOR;
  return buildTimelockScheduleCall(timelock, {
    target: inner.to,
    value: BigInt(inner.value || "0"),
    data: inner.data,
    predecessor,
    salt,
    delay: BigInt(delaySec),
  });
}
