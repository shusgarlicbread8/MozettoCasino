import type { Address, Hex } from "viem";

/** Normalized on-chain SeatTicketV3 (all bigints). */
export type SeatTicketV3Wire = {
  arenaAccount: Address;
  gameTemplateId: Hex;
  matchmakingPool: Hex;
  buyIn: bigint;
  controllerHash: Hex;
  profileConfigHash: Hex;
  modelPolicyHash: Hex;
  leagueBit: number;
  rated: boolean;
  expiresAt: bigint;
  nonce: bigint;
};

/** One seated participant ready for SESSION_V2 commitment + SeatTicketV3. */
export type SealParticipant = {
  owner: Address;
  ticket: {
    arenaAccount: Address;
    gameTemplateId: Hex;
    matchmakingPool: Hex;
    buyIn: bigint | number | string;
    controllerHash: Hex;
    profileConfigHash: Hex;
    modelPolicyHash: Hex;
    leagueBit: number;
    rated: boolean;
    expiresAt: bigint | number | string;
    nonce: bigint | number | string;
  };
  /** Ticket EIP-712 / EIP-1271 signature over SeatTicketV3. */
  signature: Hex;
};

/** Policy / secrecy fields bound into SessionDescriptorV2 at seal. */
export type SealPolicy = {
  dealerSecretRoot: Hex;
  randomnessPolicyId: Hex;
  settlementPolicyId: Hex;
};

export type SessionDescriptorV2Wire = {
  chainId: bigint;
  protocolVersion: 3;
  sessionId: Hex;
  gameTemplateId: Hex;
  participantRoot: Hex;
  openingBalanceRoot: Hex;
  controllerRoot: Hex;
  profileRoot: Hex;
  dealerSecretRoot: Hex;
  randomnessPolicyId: Hex;
  settlementPolicyId: Hex;
  createdAt: bigint;
  sealDeadline: bigint;
  sessionNonce: Hex;
};

export type SessionCommitments = {
  descriptor: SessionDescriptorV2Wire;
  sessionDescriptorHash: Hex;
  participantLeaves: Hex[];
  openingBalanceLeaves: Hex[];
  controllerLeaves: Hex[];
  /** Raw profileConfigHash values (vault merklizes these directly). */
  profileLeaves: Hex[];
  /** Tickets in ascending seat order (tickets[i] ⇒ seat i). */
  orderedTickets: SeatTicketV3Wire[];
  orderedSignatures: Hex[];
  orderedOwners: Address[];
};

export type SealPrepareInput = {
  chainId: bigint;
  gameTemplateId: Hex;
  /** Participants in any order; seats assigned via seatOrder. */
  participants: SealParticipant[];
  /**
   * WP-040 `seat_order`: permutation of `[0..n-1]`.
   * Participant at index `i` is assigned seat `seatOrder[i]`.
   * If omitted, seats follow input order (`[0,1,...,n-1]`).
   */
  seatOrder?: number[];
  sessionNonce: Hex;
  createdAt: bigint;
  sealDeadline: bigint;
  policy: SealPolicy;
};

export type SealCalldata = {
  to: Address;
  data: Hex;
  descriptor: SessionDescriptorV2Wire;
  tickets: SeatTicketV3Wire[];
  signatures: Hex[];
};

export type SealMode = "dry-run" | "submit";

export type SealResult =
  | {
      mode: "dry-run";
      ok: true;
      commitments: SessionCommitments;
      calldata: SealCalldata;
    }
  | {
      mode: "submit";
      ok: true;
      commitments: SessionCommitments;
      txHash: Hex;
    }
  | {
      mode: SealMode;
      ok: false;
      error: string;
      commitments?: SessionCommitments;
    };

/** Pluggable vault / relayer for Anvil or mocked unit tests. */
export type VaultSealClient = {
  vaultAddress: Address;
  sealAndFundSession: (args: {
    descriptor: SessionDescriptorV2Wire;
    tickets: SeatTicketV3Wire[];
    signatures: Hex[];
  }) => Promise<Hex>;
};
