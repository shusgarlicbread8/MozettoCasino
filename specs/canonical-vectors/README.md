# Canonical golden vectors

**Status:** frozen — WP-015 enforced identical keccak256 digests in TypeScript, Rust, and Solidity.

## Regenerating

From repository root (requires `viem` via workspace install):

```bash
node scripts/compute-canonical-vectors.mjs
```

This overwrites `01`–`14` and `_domains.json`.

## Common fields

Each vector JSON includes:

| Field | Meaning |
|---|---|
| `vectorId` | Stable id |
| `specRefs` | Normative markdown specs |
| `hashStatus` | `computed` when keccak was produced by the script |
| `hashingAlgorithm` | Always keccak256 over ABI (or EIP-712) — never raw JSON |
| `humanReadableInput` | Human projection of the scenario |
| `canonicalBytesHex` | ABI preimage hex (or EIP-712 digest bytes context) |
| `keccak256` | Expected digest / root |
| `expectedDecodedStructure` | Structured expectation |
| `expectedFailureMutations` | Mutations that MUST fail |

## Index

| File | Tests |
|---|---|
| `01_session_hu.json` | HU SessionDescriptorV2 |
| `02_session_sixmax.json` | Six-max SessionDescriptorV2 |
| `03_preflop_sequence.json` | Event hash chain |
| `04_incomplete_allin_raise.json` | Incomplete raise legality |
| `05_three_way_side_pot.json` | Side pots + balance root |
| `06_split_pot_odd_chip.json` | Odd-chip rule |
| `07_card_leaf_merkle.json` | Card leaf + deck Merkle proof |
| `08_dealer_secret_hand_seed.json` | Secret leaves + handSeed |
| `09_profile_hash.json` | ProfileConfigV1 |
| `10_model_policy_groq.json` | Groq Season 1 model policy |
| `11_energy_ledger_hand.json` | Energy ops + ledger |
| `12_final_settlement_eip712.json` | FinalSettlementV3 digest |
| `13_proof_batch_root.json` | ProofBatchV1 |
| `14_emergency_exit_balance_leaf.json` | Emergency balance leaf + proof |
| `_domains.json` | Domain tag digests |

## Notes

- Fixture addresses are checksummed demo addresses, not production keys.
- Vector 07 uses fixture card salts (`keccak256("card-salt-i")`); production salt rules are in `MOZETTO_RANDOMNESS_V2.md`.
- Empirical Season 1 defaults in vectors (Energy costs, token limits, checkpoint commentary) are hypotheses.
- Do not treat JSON field order as consensus; only `canonicalBytesHex` / documented `abi.encode` lists are authoritative.
