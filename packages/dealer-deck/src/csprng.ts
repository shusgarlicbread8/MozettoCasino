import {
  encodeAbiParameters,
  keccak256,
  parseAbiParameters,
  type Hex,
} from "viem";

/**
 * Randomness V2 CSPRNG: successive keccak256(abi.encode(handSeed, uint64 counter))
 * blocks, consumed as big-endian uint32 words.
 */
export class HandSeedCsprng {
  private readonly handSeed: Hex;
  private blockCounter = 0n;
  private block: Uint8Array = new Uint8Array(0);
  private offset = 0;
  /** Total uint32 draws (including rejected samples). */
  draws = 0;

  /** Optional forced uint32 stream for tests (consumed first). */
  private forced: number[] | null = null;

  constructor(handSeed: Hex) {
    this.handSeed = handSeed;
  }

  /** Test-only: prepend values to the uint32 stream. */
  forceUint32Sequence(values: readonly number[]): void {
    this.forced = [...values];
  }

  private refill(): void {
    const encoded = encodeAbiParameters(parseAbiParameters("bytes32 handSeed, uint64 counter"), [
      this.handSeed,
      this.blockCounter,
    ]);
    this.blockCounter += 1n;
    const hex = keccak256(encoded).slice(2);
    this.block = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      this.block[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    this.offset = 0;
  }

  /** Next big-endian uint32 from the stream. */
  nextUint32(): number {
    if (this.forced && this.forced.length > 0) {
      this.draws += 1;
      return this.forced.shift()! >>> 0;
    }
    if (this.offset + 4 > this.block.length) this.refill();
    const o = this.offset;
    const v =
      ((this.block[o]! << 24) |
        (this.block[o + 1]! << 16) |
        (this.block[o + 2]! << 8) |
        this.block[o + 3]!) >>>
      0;
    this.offset = o + 4;
    this.draws += 1;
    return v;
  }

  /**
   * Uniform sample in `[0, bound)` via rejection sampling (bound = i+1 in Fisher–Yates).
   * MUST NOT use raw `x % bound` alone.
   */
  uniformBelow(bound: number): number {
    if (!Number.isInteger(bound) || bound < 1 || bound > 0x1_0000_0000) {
      throw new Error(`uniformBelow: invalid bound ${bound}`);
    }
    if (bound === 1) return 0;
    // floor(2^32 / bound) * bound — bigint avoids float rounding on the multiply
    const limit = Number((1n << 32n) / BigInt(bound) * BigInt(bound));
    for (;;) {
      const x = this.nextUint32();
      if (x < limit) return x % bound;
    }
  }
}
