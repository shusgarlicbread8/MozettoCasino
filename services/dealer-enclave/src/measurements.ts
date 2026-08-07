import { encodeAbiParameters, keccak256, type Hex } from "viem";
import {
  MOCK_APPROVED_PCR0,
  MOCK_APPROVED_PCR1,
  MOCK_APPROVED_PCR2,
} from "./constants.js";
import type { EnclaveMeasurement } from "./types.js";

/**
 * Hash the PCR triple into the single bytes32 used in DealerBatchAttestation.
 * Production should pin the same algorithm when publishing measurements.
 */
export function measurementHashFromPcrs(pcrs: {
  pcr0: Hex;
  pcr1: Hex;
  pcr2: Hex;
  pcr3?: Hex;
}): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
      ],
      [
        normalizeBytes32(pcrs.pcr0),
        normalizeBytes32(pcrs.pcr1),
        normalizeBytes32(pcrs.pcr2),
        normalizeBytes32(pcrs.pcr3 ?? (`0x${"00".repeat(32)}` as Hex)),
      ],
    ),
  );
}

export function defaultMockMeasurement(label = "mock-wp054-local"): EnclaveMeasurement {
  const pcr0 = MOCK_APPROVED_PCR0;
  const pcr1 = MOCK_APPROVED_PCR1;
  const pcr2 = MOCK_APPROVED_PCR2;
  return {
    pcr0,
    pcr1,
    pcr2,
    measurementHash: measurementHashFromPcrs({ pcr0, pcr1, pcr2 }),
    label,
  };
}

/** In-memory registry of measurements allowed to receive KMS material / sign batches. */
export class ApprovedMeasurementRegistry {
  private readonly byHash = new Map<string, EnclaveMeasurement>();

  constructor(initial: EnclaveMeasurement[] = [defaultMockMeasurement()]) {
    for (const m of initial) this.register(m);
  }

  register(m: EnclaveMeasurement): void {
    this.byHash.set(m.measurementHash.toLowerCase(), m);
  }

  get(measurementHash: Hex): EnclaveMeasurement | undefined {
    return this.byHash.get(measurementHash.toLowerCase());
  }

  isApproved(measurementHash: Hex): boolean {
    return this.byHash.has(measurementHash.toLowerCase());
  }

  list(): EnclaveMeasurement[] {
    return [...this.byHash.values()];
  }
}

function normalizeBytes32(raw: Hex): Hex {
  const hex = raw.startsWith("0x") ? raw.slice(2) : raw;
  return (`0x${hex.padStart(64, "0").slice(-64).toLowerCase()}`) as Hex;
}
