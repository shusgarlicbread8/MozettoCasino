# Mozetto Protocol Specifications

**Status:** `frozen` (WP-015 cross-language agreement — TS / Rust / Solidity)  
**Authority:** `mozetto_execution_plans/02_PROTOCOL_AND_CANONICAL_SPECS.md`  
**Protocol major:** `3`  
**Last updated:** 2026-08-07

## Purpose

This directory freezes the vocabulary and binary encodings for Mozetto Protocol V3 before any RandomnessBeaconV2, SettlementHubV3, Rust engine, or continuous Groq runtime implementation.

Implementations MUST NOT hash raw JSON for consensus objects. Consensus digests use `keccak256` over ABI-encoded preimages with domain separation.

## How to use

1. Read `MOZETTO_PROTOCOL_V3.md` first (shared primitives, domains, Merkle, money, cards).
2. Read the object-specific spec you are implementing.
3. Drive encoders/decoders against `canonical-vectors/*.json`.
4. CI must fail if TypeScript, Rust, and Solidity disagree on any vector hash:

```bash
pnpm test:protocol-vectors          # @mozetto/protocol-vectors
cargo test -p protocol-vectors-rs
cd contracts && forge test --match-contract ProtocolVectors
# or: pnpm test:protocol-vectors:all
```

Regenerate fixture hashes (authoritative generator; keep languages aligned):

```bash
node scripts/compute-canonical-vectors.mjs
```

## Spec status table

| Spec | Version string | Status | Work packet |
|---|---|---|---|
| `MOZETTO_PROTOCOL_V3.md` | `MOZETTO_PROTOCOL_V3` | `frozen` | WP-010 |
| `MOZETTO_GAME_TEMPLATE_V2.md` | `MOZETTO_GAME_TEMPLATE_V2` | `frozen` | WP-010 |
| `MOZETTO_SESSION_V2.md` | `MOZETTO_SESSION_V2` | `frozen` | WP-010 |
| `MOZETTO_POKER_EVENT_V1.md` | `MOZETTO_POKER_EVENT_V1` | `frozen` | WP-011 |
| `MOZETTO_RANDOMNESS_V2.md` | `MOZETTO_RANDOMNESS_V2` | `frozen` | WP-012 |
| `MOZETTO_SETTLEMENT_V3.md` | `MOZETTO_SETTLEMENT_V3` | `frozen` | WP-013 |
| `MOZETTO_PROOF_BATCH_V1.md` | `MOZETTO_PROOF_BATCH_V1` | `frozen` | WP-013 |
| `MOZETTO_CONTROLLER_V1.md` | `MOZETTO_CONTROLLER_V1` | `frozen` | WP-014 |
| `MOZETTO_ENERGY_V1.md` | `MOZETTO_ENERGY_V1` | `frozen` | WP-014 |

`frozen` means encodings and domain tags are locked for Protocol V3. Any change to encoded fields or hashing requires a new version. Active sessions MUST retain the version they opened with.

## Golden vectors

| ID | File | Primary object |
|---|---|---|
| 01 | `canonical-vectors/01_session_hu.json` | SessionDescriptorV2 (HU) |
| 02 | `canonical-vectors/02_session_sixmax.json` | SessionDescriptorV2 (6-max) |
| 03 | `canonical-vectors/03_preflop_sequence.json` | PokerEventV1 chain |
| 04 | `canonical-vectors/04_incomplete_allin_raise.json` | Incomplete all-in legality |
| 05 | `canonical-vectors/05_three_way_side_pot.json` | Side pots + balance root |
| 06 | `canonical-vectors/06_split_pot_odd_chip.json` | Odd-chip split |
| 07 | `canonical-vectors/07_card_leaf_merkle.json` | Card leaf + deck Merkle |
| 08 | `canonical-vectors/08_dealer_secret_hand_seed.json` | Secret root + hand seed |
| 09 | `canonical-vectors/09_profile_hash.json` | ProfileConfigV1 |
| 10 | `canonical-vectors/10_model_policy_groq.json` | ModelPolicy Season 1 |
| 11 | `canonical-vectors/11_energy_ledger_hand.json` | Energy ledger |
| 12 | `canonical-vectors/12_final_settlement_eip712.json` | FinalSettlementV3 EIP-712 |
| 13 | `canonical-vectors/13_proof_batch_root.json` | ProofBatchV1 |
| 14 | `canonical-vectors/14_emergency_exit_balance_leaf.json` | Emergency balance leaf |

Domain tag digests are listed in `canonical-vectors/_domains.json` and in `MOZETTO_PROTOCOL_V3.md`.

## Conformance packages (WP-015)

| Language | Path | Command |
|---|---|---|
| TypeScript | `packages/protocol-vectors-ts` (`@mozetto/protocol-vectors`) | `pnpm test:protocol-vectors` |
| Rust | `crates/protocol-vectors-rs` | `cargo test -p protocol-vectors-rs` |
| Solidity | `contracts/test/ProtocolVectors.t.sol` | `forge test --match-contract ProtocolVectors` |

## Locked Season 1 decisions (do not silently mutate)

- Settlement network: Base (Anvil `31337` for local vectors).
- Asset: USDC 6 decimals (`1 USDC = 1_000_000` base units).
- Custody: idle funds in ArenaAccount; buy-in locked into vault.
- Execution: off-chain real-time; chain holds custody, commitments, proofs, settlement.
- Cards: `0..51` with Plan 02 mapping (see Protocol V3).
- Energy: `100` per seat per hand; unused expires.
- Model: Groq `openai/gpt-oss-120b` only for ranked Season 1.
- Empirical defaults (rake %, Energy debits, Groq sampling, checkpoint frequency) are marked **initial defaults / hypotheses** in the relevant specs.

## Out of scope here

- Contract/engine/runtime implementation (Wave 2+).
- Changing frozen encodings without a new version string.
