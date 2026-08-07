//! Mozetto Protocol V3 ABI encoders for golden-vector conformance (WP-015).

use alloy_primitives::{keccak256, Address, B256, U256};
use alloy_sol_types::{sol, SolValue};

sol! {
    struct SessionDescriptorPreimage {
        bytes32 domain;
        uint256 chainId;
        uint16 protocolVersion;
        bytes32 sessionId;
        bytes32 gameTemplateId;
        bytes32 participantRoot;
        bytes32 openingBalanceRoot;
        bytes32 controllerRoot;
        bytes32 profileRoot;
        bytes32 dealerSecretRoot;
        bytes32 randomnessPolicyId;
        bytes32 settlementPolicyId;
        uint64 createdAt;
        uint64 sealDeadline;
        bytes32 sessionNonce;
    }

    struct ProfilePreimage {
        bytes32 domain;
        bytes32 profileId;
        uint16 profileVersion;
        bytes32 presetId;
        uint8 aggression;
        uint8 riskTolerance;
        uint8 deception;
        uint8 opponentAdaptation;
        uint8 trapPreference;
        uint8 tempo;
        uint8 variancePreference;
        uint8 energyConservation;
        uint32 allowedSchedulerWeights;
        uint64 createdAt;
        uint32 ownerCustomizationVersion;
    }

    struct ModelPolicyPreimage {
        bytes32 domain;
        bytes32 policyId;
        uint16 policyVersion;
        bytes32 providerId;
        bytes32 modelId;
        bytes32 reasoningEffortPolicy;
        bytes32 outputMode;
        uint32 maxOutputTokens;
        uint32 temperatureMilli;
        bytes32 masterPolicyHash;
        bytes32 profileSetHash;
        bytes32 energyPolicyHash;
        bytes32 contextTruncationPolicy;
        bytes32 fallbackPolicyHash;
        bool toolsDisabled;
    }

    struct EventPreimage {
        bytes32 domain;
        uint16 protocolVersion;
        bytes32 sessionId;
        uint64 epoch;
        uint64 handNumber;
        uint64 sequence;
        uint16 eventType;
        bool hasActorSeat;
        uint8 actorSeat;
        bytes32 publicPayloadHash;
        bytes32 privatePayloadCommitment;
        uint64 elapsedMs;
        bytes32 previousEventHash;
        bytes32 engineHash;
    }

    struct CardLeafPreimage {
        bytes32 domain;
        bytes32 handId;
        uint8 position;
        uint8 cardCode;
        bytes32 cardSalt;
    }

    struct SecretLeafPreimage {
        bytes32 domain;
        bytes32 sessionId;
        uint64 randomnessEpoch;
        uint16 index;
        bytes32 secret;
    }

    struct HandSeedPreimage {
        bytes32 domain;
        bytes32 secret;
        bytes32 vrfR;
        bytes32 sessionId;
        uint64 epoch;
        uint16 index;
    }

    struct BalanceLeafPreimage {
        bytes32 domain;
        bytes32 sessionId;
        uint64 epoch;
        address arenaAccount;
        uint8 seat;
        uint256 openingBalance;
        uint256 currentBalance;
        uint256 cumulativeRake;
        uint64 lastSequence;
    }

    struct EnergyLedgerPreimage {
        bytes32 domain;
        bytes32 sessionId;
        bytes32 handId;
        uint8 seat;
        uint16 startingEnergy;
        bytes32 opsRoot;
        uint16 endingEnergy;
    }

    struct ProofBatchPreimage {
        bytes32 domain;
        uint64 sequence;
        bytes32 previousBatchRoot;
        bytes32 globalRoot;
        bytes32 dataManifestHash;
        uint64 createdAt;
    }

    struct HandIdPreimage {
        bytes32 domain;
        bytes32 sessionId;
        uint64 epoch;
        uint64 handNumber;
    }

    struct OddChipPreimage {
        uint256 pot;
        uint8 button;
        uint8 w0;
        uint8 w1;
        uint256 a0;
        uint256 a1;
    }

    struct SettlementStructPreimage {
        bytes32 typehash;
        bytes32 sessionId;
        uint64 finalSequence;
        bytes32 finalEventRoot;
        bytes32 handRoot;
        bytes32 balanceRoot;
        bytes32 randomnessEpochId;
        uint256 openingTotal;
        uint256 endingPlayerTotal;
        uint256 totalRake;
        uint64 proofBatchSequence;
        bytes32 modelPolicyHash;
        bytes32 profileSetHash;
        bytes32 gameTemplateId;
        bytes32 engineHash;
        uint256 deadline;
    }

    struct Eip712DomainPreimage {
        bytes32 typehash;
        bytes32 name;
        bytes32 version;
        uint256 chainId;
        address verifyingContract;
    }

    struct BlindPayload {
        uint8 seat;
        uint256 amount;
    }

    struct ActionPayload {
        uint8 seat;
        uint16 action;
        uint256 amount;
    }
}

pub fn domain_tag(s: &str) -> B256 {
    keccak256(s.as_bytes())
}

pub mod domains {
    use super::domain_tag;
    use alloy_primitives::B256;

    macro_rules! dom {
        ($fn:ident, $s:expr) => {
            pub fn $fn() -> B256 {
                domain_tag($s)
            }
        };
    }

    dom!(session_v2, "MOZETTO_SESSION_V2");
    dom!(session_id_v1, "MOZETTO_SESSION_ID_V1");
    dom!(hand_id_v1, "MOZETTO_HAND_ID_V1");
    dom!(participant_leaf_v1, "MOZETTO_PARTICIPANT_LEAF_V1");
    dom!(event_v1, "MOZETTO_EVENT_V1");
    dom!(card_leaf_v1, "MOZETTO_CARD_LEAF_V1");
    dom!(secret_leaf_v1, "MOZETTO_SECRET_LEAF_V1");
    dom!(hand_seed_v1, "MOZETTO_HAND_SEED_V1");
    dom!(balance_leaf_v1, "MOZETTO_BALANCE_LEAF_V1");
    dom!(profile_v1, "MOZETTO_PROFILE_V1");
    dom!(model_policy_v1, "MOZETTO_MODEL_POLICY_V1");
    dom!(proof_batch_v1, "MOZETTO_PROOF_BATCH_V1");
    dom!(energy_op_v1, "MOZETTO_ENERGY_OP_V1");
    dom!(energy_ledger_v1, "MOZETTO_ENERGY_LEDGER_V1");
    dom!(opening_balance_leaf_v1, "MOZETTO_OPENING_BALANCE_LEAF_V1");
    dom!(controller_leaf_v1, "MOZETTO_CONTROLLER_LEAF_V1");
    dom!(deck_root_v1, "MOZETTO_DECK_ROOT_V1");
    dom!(settlement_v3, "MOZETTO_SETTLEMENT_V3");
    dom!(game_template_v2, "MOZETTO_GAME_TEMPLATE_V2");
    dom!(controller_req_v1, "MOZETTO_CONTROLLER_REQUEST_V1");
    dom!(controller_resp_v1, "MOZETTO_CONTROLLER_RESPONSE_V1");
    dom!(deck_batch_v1, "MOZETTO_DECK_BATCH_V1");
    dom!(hand_root_v1, "MOZETTO_HAND_ROOT_V1");
}

/// Ordered Merkle: pad to power-of-2 with zeros; parent = keccak256(left || right).
pub fn merkle_root(leaves: &[B256]) -> B256 {
    if leaves.is_empty() {
        return B256::ZERO;
    }
    let mut level: Vec<B256> = leaves.to_vec();
    while level.len() & (level.len() - 1) != 0 {
        level.push(B256::ZERO);
    }
    while level.len() > 1 {
        let mut next = Vec::with_capacity(level.len() / 2);
        for chunk in level.chunks(2) {
            let mut buf = [0u8; 64];
            buf[..32].copy_from_slice(chunk[0].as_slice());
            buf[32..].copy_from_slice(chunk[1].as_slice());
            next.push(keccak256(buf));
        }
        level = next;
    }
    level[0]
}

pub fn session_descriptor_hash(
    chain_id: U256,
    protocol_version: u16,
    session_id: B256,
    game_template_id: B256,
    participant_root: B256,
    opening_balance_root: B256,
    controller_root: B256,
    profile_root: B256,
    dealer_secret_root: B256,
    randomness_policy_id: B256,
    settlement_policy_id: B256,
    created_at: u64,
    seal_deadline: u64,
    session_nonce: B256,
) -> B256 {
    keccak256(
        SessionDescriptorPreimage {
            domain: domains::session_v2(),
            chainId: chain_id,
            protocolVersion: protocol_version,
            sessionId: session_id,
            gameTemplateId: game_template_id,
            participantRoot: participant_root,
            openingBalanceRoot: opening_balance_root,
            controllerRoot: controller_root,
            profileRoot: profile_root,
            dealerSecretRoot: dealer_secret_root,
            randomnessPolicyId: randomness_policy_id,
            settlementPolicyId: settlement_policy_id,
            createdAt: created_at,
            sealDeadline: seal_deadline,
            sessionNonce: session_nonce,
        }
        .abi_encode(),
    )
}

pub fn profile_hash(
    profile_id: B256,
    profile_version: u16,
    preset_id: B256,
    aggression: u8,
    risk_tolerance: u8,
    deception: u8,
    opponent_adaptation: u8,
    trap_preference: u8,
    tempo: u8,
    variance_preference: u8,
    energy_conservation: u8,
    allowed_scheduler_weights: u32,
    created_at: u64,
    owner_customization_version: u32,
) -> B256 {
    keccak256(
        ProfilePreimage {
            domain: domains::profile_v1(),
            profileId: profile_id,
            profileVersion: profile_version,
            presetId: preset_id,
            aggression,
            riskTolerance: risk_tolerance,
            deception,
            opponentAdaptation: opponent_adaptation,
            trapPreference: trap_preference,
            tempo,
            variancePreference: variance_preference,
            energyConservation: energy_conservation,
            allowedSchedulerWeights: allowed_scheduler_weights,
            createdAt: created_at,
            ownerCustomizationVersion: owner_customization_version,
        }
        .abi_encode(),
    )
}

pub fn model_policy_hash(
    policy_id: B256,
    policy_version: u16,
    provider_id: B256,
    model_id: B256,
    reasoning_effort_policy: B256,
    output_mode: B256,
    max_output_tokens: u32,
    temperature_milli: u32,
    master_policy_hash: B256,
    profile_set_hash: B256,
    energy_policy_hash: B256,
    context_truncation_policy: B256,
    fallback_policy_hash: B256,
    tools_disabled: bool,
) -> B256 {
    keccak256(
        ModelPolicyPreimage {
            domain: domains::model_policy_v1(),
            policyId: policy_id,
            policyVersion: policy_version,
            providerId: provider_id,
            modelId: model_id,
            reasoningEffortPolicy: reasoning_effort_policy,
            outputMode: output_mode,
            maxOutputTokens: max_output_tokens,
            temperatureMilli: temperature_milli,
            masterPolicyHash: master_policy_hash,
            profileSetHash: profile_set_hash,
            energyPolicyHash: energy_policy_hash,
            contextTruncationPolicy: context_truncation_policy,
            fallbackPolicyHash: fallback_policy_hash,
            toolsDisabled: tools_disabled,
        }
        .abi_encode(),
    )
}

pub fn event_hash(
    protocol_version: u16,
    session_id: B256,
    epoch: u64,
    hand_number: u64,
    sequence: u64,
    event_type: u16,
    has_actor_seat: bool,
    actor_seat: u8,
    public_payload_hash: B256,
    private_payload_commitment: B256,
    elapsed_ms: u64,
    previous_event_hash: B256,
    engine_hash: B256,
) -> B256 {
    keccak256(
        EventPreimage {
            domain: domains::event_v1(),
            protocolVersion: protocol_version,
            sessionId: session_id,
            epoch,
            handNumber: hand_number,
            sequence,
            eventType: event_type,
            hasActorSeat: has_actor_seat,
            actorSeat: actor_seat,
            publicPayloadHash: public_payload_hash,
            privatePayloadCommitment: private_payload_commitment,
            elapsedMs: elapsed_ms,
            previousEventHash: previous_event_hash,
            engineHash: engine_hash,
        }
        .abi_encode(),
    )
}

pub fn card_leaf(hand_id: B256, position: u8, card_code: u8, card_salt: B256) -> B256 {
    keccak256(
        CardLeafPreimage {
            domain: domains::card_leaf_v1(),
            handId: hand_id,
            position,
            cardCode: card_code,
            cardSalt: card_salt,
        }
        .abi_encode(),
    )
}

pub fn secret_leaf(session_id: B256, randomness_epoch: u64, index: u16, secret: B256) -> B256 {
    keccak256(
        SecretLeafPreimage {
            domain: domains::secret_leaf_v1(),
            sessionId: session_id,
            randomnessEpoch: randomness_epoch,
            index,
            secret,
        }
        .abi_encode(),
    )
}

pub fn hand_seed(secret: B256, vrf_r: B256, session_id: B256, epoch: u64, index: u16) -> B256 {
    keccak256(
        HandSeedPreimage {
            domain: domains::hand_seed_v1(),
            secret,
            vrfR: vrf_r,
            sessionId: session_id,
            epoch,
            index,
        }
        .abi_encode(),
    )
}

pub fn balance_leaf(
    session_id: B256,
    epoch: u64,
    arena_account: Address,
    seat: u8,
    opening_balance: U256,
    current_balance: U256,
    cumulative_rake: U256,
    last_sequence: u64,
) -> B256 {
    keccak256(
        BalanceLeafPreimage {
            domain: domains::balance_leaf_v1(),
            sessionId: session_id,
            epoch,
            arenaAccount: arena_account,
            seat,
            openingBalance: opening_balance,
            currentBalance: current_balance,
            cumulativeRake: cumulative_rake,
            lastSequence: last_sequence,
        }
        .abi_encode(),
    )
}

pub fn energy_ledger_hash(
    session_id: B256,
    hand_id: B256,
    seat: u8,
    starting_energy: u16,
    ops_root: B256,
    ending_energy: u16,
) -> B256 {
    keccak256(
        EnergyLedgerPreimage {
            domain: domains::energy_ledger_v1(),
            sessionId: session_id,
            handId: hand_id,
            seat,
            startingEnergy: starting_energy,
            opsRoot: ops_root,
            endingEnergy: ending_energy,
        }
        .abi_encode(),
    )
}

pub fn proof_batch_leaf(
    sequence: u64,
    previous_batch_root: B256,
    global_root: B256,
    data_manifest_hash: B256,
    created_at: u64,
) -> B256 {
    keccak256(
        ProofBatchPreimage {
            domain: domains::proof_batch_v1(),
            sequence,
            previousBatchRoot: previous_batch_root,
            globalRoot: global_root,
            dataManifestHash: data_manifest_hash,
            createdAt: created_at,
        }
        .abi_encode(),
    )
}

pub fn derive_hand_id(session_id: B256, epoch: u64, hand_number: u64) -> B256 {
    keccak256(
        HandIdPreimage {
            domain: domains::hand_id_v1(),
            sessionId: session_id,
            epoch,
            handNumber: hand_number,
        }
        .abi_encode(),
    )
}

pub fn odd_chip_split_hash(pot: U256, button: u8, w0: u8, w1: u8, a0: U256, a1: U256) -> B256 {
    keccak256(
        OddChipPreimage {
            pot,
            button,
            w0,
            w1,
            a0,
            a1,
        }
        .abi_encode(),
    )
}

pub fn blind_payload_hash(seat: u8, amount: U256) -> B256 {
    keccak256(BlindPayload { seat, amount }.abi_encode())
}

pub fn action_payload_hash(seat: u8, action: u16, amount: U256) -> B256 {
    keccak256(
        ActionPayload {
            seat,
            action,
            amount,
        }
        .abi_encode(),
    )
}

pub fn settlement_eip712_digest(
    session_id: B256,
    final_sequence: u64,
    final_event_root: B256,
    hand_root: B256,
    balance_root: B256,
    randomness_epoch_id: B256,
    opening_total: U256,
    ending_player_total: U256,
    total_rake: U256,
    proof_batch_sequence: u64,
    model_policy_hash: B256,
    profile_set_hash: B256,
    game_template_id: B256,
    engine_hash: B256,
    deadline: U256,
    chain_id: U256,
    verifying_contract: Address,
) -> (B256, B256, B256, B256) {
    let typehash = keccak256(
        b"FinalSettlementV3(bytes32 sessionId,uint64 finalSequence,bytes32 finalEventRoot,bytes32 handRoot,bytes32 balanceRoot,bytes32 randomnessEpochId,uint256 openingTotal,uint256 endingPlayerTotal,uint256 totalRake,uint64 proofBatchSequence,bytes32 modelPolicyHash,bytes32 profileSetHash,bytes32 gameTemplateId,bytes32 engineHash,uint256 deadline)",
    );
    let struct_hash = keccak256(
        SettlementStructPreimage {
            typehash,
            sessionId: session_id,
            finalSequence: final_sequence,
            finalEventRoot: final_event_root,
            handRoot: hand_root,
            balanceRoot: balance_root,
            randomnessEpochId: randomness_epoch_id,
            openingTotal: opening_total,
            endingPlayerTotal: ending_player_total,
            totalRake: total_rake,
            proofBatchSequence: proof_batch_sequence,
            modelPolicyHash: model_policy_hash,
            profileSetHash: profile_set_hash,
            gameTemplateId: game_template_id,
            engineHash: engine_hash,
            deadline,
        }
        .abi_encode(),
    );
    let domain_separator = keccak256(
        Eip712DomainPreimage {
            typehash: keccak256(
                b"EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)",
            ),
            name: keccak256(b"MozettoPokerSettlement"),
            version: keccak256(b"3"),
            chainId: chain_id,
            verifyingContract: verifying_contract,
        }
        .abi_encode(),
    );
    let mut digest_input = Vec::with_capacity(66);
    digest_input.extend_from_slice(&[0x19, 0x01]);
    digest_input.extend_from_slice(domain_separator.as_slice());
    digest_input.extend_from_slice(struct_hash.as_slice());
    let digest = keccak256(digest_input);
    (typehash, struct_hash, domain_separator, digest)
}

pub fn parse_b256(s: &str) -> B256 {
    s.parse().expect("invalid bytes32 hex")
}

pub fn parse_address(s: &str) -> Address {
    s.parse().expect("invalid address hex")
}

pub fn parse_u256(s: &str) -> U256 {
    U256::from_str_radix(s, 10).unwrap_or_else(|_| s.parse::<U256>().expect("invalid u256"))
}

pub fn keccak_str(s: &str) -> B256 {
    keccak256(s.as_bytes())
}
