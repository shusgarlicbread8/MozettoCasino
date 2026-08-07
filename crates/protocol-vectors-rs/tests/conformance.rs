//! WP-015 Rust conformance: re-encode against specs/canonical-vectors/*.json

use alloy_primitives::{Address, B256, U256};
use protocol_vectors_rs::*;
use serde_json::Value;
use std::fs;
use std::path::PathBuf;

fn vectors_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../specs/canonical-vectors")
}

fn load(name: &str) -> Value {
    let path = vectors_dir().join(name);
    let raw = fs::read_to_string(&path).unwrap_or_else(|e| panic!("read {}: {e}", path.display()));
    serde_json::from_str(&raw).expect("json")
}

fn hex_b256(v: &Value) -> B256 {
    parse_b256(v.as_str().expect("hex str"))
}

fn u256_from(v: &Value) -> U256 {
    match v {
        Value::String(s) => parse_u256(s),
        Value::Number(n) => U256::from(n.as_u64().expect("u64")),
        _ => panic!("bad u256"),
    }
}

fn u64_from(v: &Value) -> u64 {
    match v {
        Value::String(s) => s.parse().expect("u64"),
        Value::Number(n) => n.as_u64().expect("u64"),
        _ => panic!("bad u64"),
    }
}

fn u16_from(v: &Value) -> u16 {
    u64_from(v) as u16
}

fn u8_from(v: &Value) -> u8 {
    u64_from(v) as u8
}

fn u32_from(v: &Value) -> u32 {
    u64_from(v) as u32
}

fn addr(v: &Value) -> Address {
    parse_address(v.as_str().expect("addr"))
}

fn assert_eq_hex(got: B256, expected: &Value, label: &str) {
    let exp = hex_b256(expected);
    assert_eq!(got, exp, "{label}: got {got} expected {exp}");
}

const ZERO32: B256 = B256::ZERO;

fn engine_hash() -> B256 {
    keccak_str("mozetto-nlhe-engine-v3-draft")
}

fn session_id_hu() -> B256 {
    hex_b256(&load("01_session_hu.json")["expectedDecodedStructure"]["sessionId"])
}

fn session_id_6() -> B256 {
    hex_b256(&load("02_session_sixmax.json")["expectedDecodedStructure"]["sessionId"])
}

fn session_descriptor_from(f: &Value) -> B256 {
    let s = &f["expectedDecodedStructure"];
    session_descriptor_hash(
        u256_from(&s["chainId"]),
        u16_from(&s["protocolVersion"]),
        hex_b256(&s["sessionId"]),
        hex_b256(&s["gameTemplateId"]),
        hex_b256(&s["participantRoot"]),
        hex_b256(&s["openingBalanceRoot"]),
        hex_b256(&s["controllerRoot"]),
        hex_b256(&s["profileRoot"]),
        hex_b256(&s["dealerSecretRoot"]),
        hex_b256(&s["randomnessPolicyId"]),
        hex_b256(&s["settlementPolicyId"]),
        u64_from(&s["createdAt"]),
        u64_from(&s["sealDeadline"]),
        hex_b256(&s["sessionNonce"]),
    )
}

#[test]
fn domains_match() {
    let expected = load("_domains.json");
    let pairs: &[(&str, B256)] = &[
        ("SESSION_V2", domains::session_v2()),
        ("SESSION_ID_V1", domains::session_id_v1()),
        ("HAND_ID_V1", domains::hand_id_v1()),
        ("PARTICIPANT_LEAF_V1", domains::participant_leaf_v1()),
        ("EVENT_V1", domains::event_v1()),
        ("CARD_LEAF_V1", domains::card_leaf_v1()),
        ("DECK_ROOT_V1", domains::deck_root_v1()),
        ("SECRET_LEAF_V1", domains::secret_leaf_v1()),
        ("HAND_SEED_V1", domains::hand_seed_v1()),
        ("BALANCE_LEAF_V1", domains::balance_leaf_v1()),
        ("PROFILE_V1", domains::profile_v1()),
        ("MODEL_POLICY_V1", domains::model_policy_v1()),
        ("PROOF_BATCH_V1", domains::proof_batch_v1()),
        ("SETTLEMENT_V3", domains::settlement_v3()),
        ("ENERGY_OP_V1", domains::energy_op_v1()),
        ("ENERGY_LEDGER_V1", domains::energy_ledger_v1()),
        ("GAME_TEMPLATE_V2", domains::game_template_v2()),
        ("CONTROLLER_REQ_V1", domains::controller_req_v1()),
        ("CONTROLLER_RESP_V1", domains::controller_resp_v1()),
        ("OPENING_BALANCE_LEAF_V1", domains::opening_balance_leaf_v1()),
        ("CONTROLLER_LEAF_V1", domains::controller_leaf_v1()),
        ("DECK_BATCH_V1", domains::deck_batch_v1()),
        ("HAND_ROOT_V1", domains::hand_root_v1()),
    ];
    assert_eq!(pairs.len(), expected.as_object().unwrap().len());
    for (k, got) in pairs {
        assert_eq_hex(*got, &expected[*k], k);
    }
}

#[test]
fn vector_01_session_hu() {
    let f = load("01_session_hu.json");
    assert_eq_hex(session_descriptor_from(&f), &f["keccak256"], "01");
}

#[test]
fn vector_02_session_sixmax() {
    let f = load("02_session_sixmax.json");
    assert_eq_hex(session_descriptor_from(&f), &f["keccak256"], "02");
}

#[test]
fn vector_03_preflop_sequence() {
    let f = load("03_preflop_sequence.json");
    let session_id = session_id_hu();
    let engine = engine_hash();
    let et_hand_start = 1u16;
    let et_post_blind = 2u16;
    let et_deal_hole = 3u16;
    let et_raise = 14u16;
    let et_call = 12u16;

    let specs: Vec<(u16, bool, u8, B256, B256, u64)> = vec![
        (
            et_hand_start,
            false,
            0,
            keccak_str("hand-start-1"),
            ZERO32,
            0,
        ),
        (
            et_post_blind,
            true,
            0,
            blind_payload_hash(0, U256::from(500_000u64)),
            ZERO32,
            10,
        ),
        (
            et_post_blind,
            true,
            1,
            blind_payload_hash(1, U256::from(1_000_000u64)),
            ZERO32,
            20,
        ),
        (
            et_deal_hole,
            false,
            0,
            keccak_str("hole-dealt-committed"),
            keccak_str("private-hole-commitment"),
            50,
        ),
        (
            et_raise,
            true,
            0,
            action_payload_hash(0, et_raise, U256::from(3_000_000u64)),
            ZERO32,
            4200,
        ),
        (
            et_call,
            true,
            1,
            action_payload_hash(1, et_call, U256::from(2_000_000u64)),
            ZERO32,
            8100,
        ),
    ];

    let mut prev = ZERO32;
    let mut hashes = Vec::new();
    for (i, (etype, has, seat, pubh, privc, elapsed)) in specs.into_iter().enumerate() {
        let h = event_hash(
            3,
            session_id,
            0,
            1,
            i as u64,
            etype,
            has,
            seat,
            pubh,
            privc,
            elapsed,
            prev,
            engine,
        );
        hashes.push(h);
        prev = h;
    }
    assert_eq_hex(prev, &f["keccak256"], "03 tip");
    let events = f["expectedDecodedStructure"]["events"].as_array().unwrap();
    for (i, e) in events.iter().enumerate() {
        assert_eq_hex(hashes[i], &e["eventHash"], &format!("03 event {i}"));
    }
}

#[test]
fn vector_04_incomplete_allin() {
    let f = load("04_incomplete_allin_raise.json");
    let session_id = session_id_hu();
    let engine = engine_hash();
    let et_raise = 14u16;
    let et_all_in = 15u16;
    let et_call = 12u16;
    let specs = [
        (
            et_raise,
            0u8,
            action_payload_hash(0, et_raise, U256::from(3_000_000u64)),
            3000u64,
        ),
        (
            et_all_in,
            1,
            action_payload_hash(1, et_all_in, U256::from(2_500_000u64)),
            5500,
        ),
        (
            et_call,
            0,
            action_payload_hash(0, et_call, U256::from(0u64)),
            7000,
        ),
    ];
    let mut prev = ZERO32;
    let mut hashes = Vec::new();
    for (i, (etype, seat, pubh, elapsed)) in specs.into_iter().enumerate() {
        let h = event_hash(
            3, session_id, 0, 2, i as u64, etype, true, seat, pubh, ZERO32, elapsed, prev, engine,
        );
        hashes.push(h);
        prev = h;
    }
    assert_eq_hex(prev, &f["keccak256"], "04 tip");
    let events = f["events"].as_array().unwrap();
    for (i, e) in events.iter().enumerate() {
        assert_eq_hex(hashes[i], &e["eventHash"], &format!("04 event {i}"));
    }
}

#[test]
fn vector_05_side_pot() {
    let f = load("05_three_way_side_pot.json");
    let sid = session_id_6();
    let seats: [(u8, Address, u64, u64); 3] = [
        (
            0,
            parse_address("0xa111111111111111111111111111111111111111"),
            100_000_000,
            140_000_000,
        ),
        (
            1,
            parse_address("0xa222222222222222222222222222222222222222"),
            100_000_000,
            50_000_000,
        ),
        (
            2,
            parse_address("0xa333333333333333333333333333333333333333"),
            100_000_000,
            110_000_000,
        ),
    ];
    let leaves: Vec<B256> = seats
        .iter()
        .map(|(seat, arena, open, end)| {
            balance_leaf(
                sid,
                0,
                *arena,
                *seat,
                U256::from(*open),
                U256::from(*end),
                U256::ZERO,
                100,
            )
        })
        .collect();
    let bl = &f["balanceLeaves"];
    for (i, leaf) in leaves.iter().enumerate() {
        assert_eq_hex(*leaf, &bl["leaves"][i]["leafHash"], &format!("05 leaf {i}"));
    }
    let root = merkle_root(&leaves);
    assert_eq_hex(root, &bl["balanceRoot"], "05 root");
    assert_eq_hex(root, &f["keccak256"], "05 keccak");
}

#[test]
fn vector_06_odd_chip() {
    let f = load("06_split_pot_odd_chip.json");
    let awards = &f["expectedDecodedStructure"]["awards"];
    let h = odd_chip_split_hash(
        U256::from(1_000_001u64),
        0,
        0,
        1,
        u256_from(&awards["seat0"]),
        u256_from(&awards["seat1"]),
    );
    assert_eq_hex(h, &f["keccak256"], "06");
}

#[test]
fn vector_07_card_merkle() {
    let f = load("07_card_leaf_merkle.json");
    let hand_id = hex_b256(&f["humanReadableInput"]["handId"]);
    let salt = hex_b256(&f["leaf0"]["cardSalt"]);
    let leaf = card_leaf(hand_id, 0, 0, salt);
    assert_eq_hex(leaf, &f["keccak256"], "07 leaf");

    let mut leaves = Vec::with_capacity(52);
    for i in 0u8..52 {
        let s = keccak_str(&format!("card-salt-{i}"));
        leaves.push(card_leaf(hand_id, i, i, s));
    }
    assert_eq_hex(merkle_root(&leaves), &f["deckRoot"], "07 deck");
}

#[test]
fn vector_08_secret_hand_seed() {
    let f = load("08_dealer_secret_hand_seed.json");
    let session_id = hex_b256(&f["humanReadableInput"]["sessionId"]);
    let vrf_r = hex_b256(&f["humanReadableInput"]["vrfR"]);
    let s0 = keccak_str("dealer-secret-0");
    let leaf = secret_leaf(session_id, 0, 0, s0);
    assert_eq_hex(leaf, &f["keccak256"], "08 leaf");
    let seed = hand_seed(s0, vrf_r, session_id, 0, 0);
    assert_eq_hex(seed, &f["handSeed0"], "08 seed");
    let s1 = keccak_str("dealer-secret-1");
    let root = merkle_root(&[
        secret_leaf(session_id, 0, 0, s0),
        secret_leaf(session_id, 0, 1, s1),
    ]);
    assert_eq_hex(root, &f["dealerSecretRoot"], "08 root");
}

#[test]
fn vector_09_profile() {
    let f = load("09_profile_hash.json");
    let p = &f["expectedDecodedStructure"];
    let h = profile_hash(
        hex_b256(&p["profileId"]),
        u16_from(&p["profileVersion"]),
        hex_b256(&p["presetId"]),
        u8_from(&p["aggression"]),
        u8_from(&p["riskTolerance"]),
        u8_from(&p["deception"]),
        u8_from(&p["opponentAdaptation"]),
        u8_from(&p["trapPreference"]),
        u8_from(&p["tempo"]),
        u8_from(&p["variancePreference"]),
        u8_from(&p["energyConservation"]),
        u32_from(&p["allowedSchedulerWeights"]),
        u64_from(&p["createdAt"]),
        u32_from(&p["ownerCustomizationVersion"]),
    );
    assert_eq_hex(h, &f["keccak256"], "09");
}

#[test]
fn vector_10_model_policy() {
    let f = load("10_model_policy_groq.json");
    let p = &f["expectedDecodedStructure"];
    let h = model_policy_hash(
        hex_b256(&p["policyId"]),
        u16_from(&p["policyVersion"]),
        hex_b256(&p["providerId"]),
        hex_b256(&p["modelId"]),
        hex_b256(&p["reasoningEffortPolicy"]),
        hex_b256(&p["outputMode"]),
        u32_from(&p["maxOutputTokens"]),
        u32_from(&p["temperatureMilli"]),
        hex_b256(&p["masterPolicyHash"]),
        hex_b256(&p["profileSetHash"]),
        hex_b256(&p["energyPolicyHash"]),
        hex_b256(&p["contextTruncationPolicy"]),
        hex_b256(&p["fallbackPolicyHash"]),
        p["toolsDisabled"].as_bool().unwrap(),
    );
    assert_eq_hex(h, &f["keccak256"], "10");
}

#[test]
fn vector_11_energy_ledger() {
    let f = load("11_energy_ledger_hand.json");
    let ops = f["operations"].as_array().unwrap();
    let op_hashes: Vec<B256> = ops.iter().map(|o| hex_b256(&o["opHash"])).collect();
    let ops_root = merkle_root(&op_hashes);
    assert_eq_hex(ops_root, &f["energyLedgerRoot"], "11 opsRoot");

    let session_id = session_id_hu();
    let hand_id = derive_hand_id(session_id, 0, 1);
    let decoded = &f["expectedDecodedStructure"];
    let h = energy_ledger_hash(
        session_id,
        hand_id,
        0,
        u16_from(&decoded["startingEnergy"]),
        ops_root,
        u16_from(&decoded["endingEnergy"]),
    );
    assert_eq_hex(h, &f["keccak256"], "11 ledger");
}

#[test]
fn vector_12_settlement_eip712() {
    let f = load("12_final_settlement_eip712.json");
    let s = &f["expectedDecodedStructure"];
    let (typehash, struct_hash, domain_sep, digest) = settlement_eip712_digest(
        hex_b256(&s["sessionId"]),
        u64_from(&s["finalSequence"]),
        hex_b256(&s["finalEventRoot"]),
        hex_b256(&s["handRoot"]),
        hex_b256(&s["balanceRoot"]),
        hex_b256(&s["randomnessEpochId"]),
        u256_from(&s["openingTotal"]),
        u256_from(&s["endingPlayerTotal"]),
        u256_from(&s["totalRake"]),
        u64_from(&s["proofBatchSequence"]),
        hex_b256(&s["modelPolicyHash"]),
        hex_b256(&s["profileSetHash"]),
        hex_b256(&s["gameTemplateId"]),
        hex_b256(&s["engineHash"]),
        u256_from(&s["deadline"]),
        u256_from(&s["chainId"]),
        addr(&s["verifyingContract"]),
    );
    assert_eq_hex(digest, &f["keccak256"], "12 digest");
    assert_eq_hex(typehash, &f["typehash"], "12 typehash");
    assert_eq_hex(struct_hash, &f["structHash"], "12 struct");
    assert_eq_hex(domain_sep, &f["domainSeparator"], "12 domain");
}

#[test]
fn vector_13_proof_batch() {
    let f = load("13_proof_batch_root.json");
    let checkpoints: Vec<B256> = f["checkpointRoots"]
        .as_array()
        .unwrap()
        .iter()
        .map(hex_b256)
        .collect();
    assert_eq_hex(merkle_root(&checkpoints), &f["globalRoot"], "13 global");
    let b = &f["expectedDecodedStructure"];
    let h = proof_batch_leaf(
        u64_from(&b["sequence"]),
        hex_b256(&b["previousBatchRoot"]),
        hex_b256(&b["globalRoot"]),
        hex_b256(&b["dataManifestHash"]),
        u64_from(&b["createdAt"]),
    );
    assert_eq_hex(h, &f["keccak256"], "13 batch");
}

#[test]
fn vector_14_emergency_leaf() {
    let f = load("14_emergency_exit_balance_leaf.json");
    let fields = &f["leaf"]["fields"];
    let h = balance_leaf(
        hex_b256(&fields["sessionId"]),
        u64_from(&fields["epoch"]),
        addr(&fields["arenaAccount"]),
        u8_from(&fields["seat"]),
        u256_from(&fields["openingBalance"]),
        u256_from(&fields["currentBalance"]),
        u256_from(&fields["cumulativeRake"]),
        u64_from(&fields["lastSequence"]),
    );
    assert_eq_hex(h, &f["keccak256"], "14");
}
