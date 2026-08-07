export type PublicVerifyStatus =
  | "VERIFIED"
  | "VERIFIED_WITH_ATTESTED_PRIVATE_DEALER"
  | "PENDING_BASE_ANCHOR"
  | "PENDING_SETTLEMENT"
  | "INCOMPLETE_PUBLIC_DATA"
  | "VERIFICATION_FAILED";

export type ComponentStatus = "ok" | "pending" | "missing" | "failed";

export type VerifyComponents = {
  session: ComponentStatus;
  dealerCommitment: ComponentStatus;
  vrf: ComponentStatus;
  eventRoots: ComponentStatus;
  handRoots: ComponentStatus;
  baseAnchor: ComponentStatus;
  settlement: ComponentStatus;
  attestors: ComponentStatus;
  /** Present when WP-090/085 inclusion proofs are published. */
  proofBatchInclusion?: ComponentStatus;
};

export type ProofBatchInclusionProof = {
  sessionId: string;
  checkpointId: string;
  checkpointRoot: string;
  leafIndex: number;
  proof: Array<{ sibling: string; isLeft: boolean }>;
  globalRoot: string;
  batchSequence: string;
  previousBatchRoot: string | null;
  dataManifestHash: string | null;
  proofBatchHash: string | null;
  createdAt: string | null;
  txHash: string | null;
  verifiedLocally: boolean;
};

export type ProofBatchInclusionPayload = {
  status: ComponentStatus;
  count: number;
  proofs: ProofBatchInclusionProof[];
  note: string;
};

export type LocalVerifyHints = {
  wasm: { build: string; run: string; docs: string };
  replayEvents: { run: string; docs: string };
  randomness: { run: string; docs: string };
  replayService: { verifySession: string; verifyTranscript: string };
};

export type VerifySessionPayload = {
  workPacket?: string;
  sessionId: string;
  chainId: number;
  chainName: string;
  protocolVersion?: string;
  contracts?: Record<string, string | null>;
  vaultAddress: string | null;
  gameTemplateId: string;
  hashes?: {
    engineHash: string | null;
    profileSetHash: string | null;
    dealerRoot: string | null;
    lastEventRoot: string | null;
    lastBalanceRoot: string | null;
    lastSequence: string | null;
  };
  dealerCommitment: { dealer_root?: string; secret_count?: number | null };
  vrf: Array<{ epoch_id: string; status: string; vrf_word?: string; fulfill_tx?: string }>;
  handRoots: Array<{ hand_id: string; hand_number: number; hand_root: string }>;
  checkpoints: Array<{
    sequence: string;
    hand_number: number | null;
    event_root: string;
    balance_root: string;
    tx_hash: string | null;
    randomness_epoch?: string | null;
  }>;
  eventTip?: Array<{
    sequence: string;
    event_hash: string;
    previous_event_hash: string;
    event_type: string;
    hand_id?: string | null;
    schema_kind?: string;
  }>;
  players: Array<{
    wallet_address: string;
    seat: number | null;
    controller_hash?: string | null;
    agent_profile_hash?: string | null;
  }>;
  settlement: {
    txHash: string | null;
    proposalStatus: string | null;
    attestorCount: number;
    digest?: {
      proposalId: string;
      finalSequence: string;
      eventRoot: string;
      handRoot: string;
      balanceRoot: string;
      totalRake: string;
    } | null;
  };
  components?: VerifyComponents;
  proofBatchInclusion?: ProofBatchInclusionPayload;
  result?: PublicVerifyStatus;
  status: "verified" | "incomplete" | "failed";
  sessionStatus: string;
  openTxHash: string | null;
  openedAt: string | null;
  settledAt: string | null;
  localVerify?: LocalVerifyHints;
};

export type VerifyHandPayload = {
  workPacket?: string;
  handId: string;
  handNumber: number;
  handRoot: string;
  createdAt: string;
  sessionId: string;
  checkpoint: {
    sequence: string;
    event_root: string;
    balance_root: string;
    randomness_epoch?: string | null;
    tx_hash: string | null;
  } | null;
  events: Array<{
    sequence: string;
    event_hash: string;
    previous_event_hash: string;
    event_type: string;
    schema_kind?: string;
    timestamp_ms?: number | null;
  }>;
  session: Pick<
    VerifySessionPayload,
    | "result"
    | "status"
    | "components"
    | "hashes"
    | "settlement"
    | "vrf"
    | "chainId"
    | "chainName"
    | "contracts"
    | "localVerify"
    | "proofBatchInclusion"
  > | null;
  href: string;
  sessionHref: string;
};

export type ResolvePayload = {
  kind: string;
  sessionId?: string;
  handId?: string | null;
  href: string;
  sessionHref?: string;
  handHref?: string | null;
  error?: string;
};
