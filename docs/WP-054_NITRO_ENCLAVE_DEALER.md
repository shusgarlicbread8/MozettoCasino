# WP-054 — Nitro Enclave dealer

**Authority:** Plan `05_RANDOMNESS_CONFIDENTIAL_DEALER_AND_DECK_PROOFS.md`, WP-054 in `16_AGENT_WORK_PACKETS.md`  
**Depends on:** WP-051 `@mozetto/dealer-deck`, `services/dealer/` (non-enclave HTTP)  
**Date:** 2026-08-07

---

## Delivered

| Item | Location |
|---|---|
| Enclave dealer package | `services/dealer-enclave` (`@mozetto/dealer-enclave`) |
| Attestation verifier interface | `src/attestation/document.ts` |
| Mock attestation (Anvil/local) | `src/attestation/mock.ts` |
| Nitro COSE/PKI stub (refuses) | `src/attestation/nitro-stub.ts` |
| DealerBatchAttestation sign/verify | `src/batch/dealer-attestation.ts` |
| Private cards sealed to seat (X25519 + AES-GCM) | `src/delivery/seal-cards.ts` |
| Mock KMS PCR gate | `src/kms/policy.ts` |
| Plan 05 internal API surface | `src/server.ts` + `src/api/runtime.ts` |
| Parent Dockerfile | `Dockerfile.dealer-enclave` |
| Enclave Dockerfile + nitro-cli stub | `services/dealer-enclave/Dockerfile.enclave`, `nitro/build.sh` |
| Tests | `src/attestation.test.ts` |
| This note | `docs/WP-054_NITRO_ENCLAVE_DEALER.md` |

Frozen `/specs` untouched. **No production TEE claim** without live AWS Nitro attestation.

---

## Architecture

```text
┌─────────────────────────────┐     vsock (prod) / in-process (mock)
│ Parent host                 │────────────────────────────────────┐
│  HTTP /internal/dealer/*    │                                    │
│  Never holds raw secrets    │   ┌────────────────────────────────▼──┐
│  in production              │   │ Nitro Enclave (EIF)               │
└─────────────────────────────┘   │  @mozetto/dealer-deck             │
                                  │  dealer secrets + shuffle         │
                                  │  NSM attestation document         │
                                  │  KMS Decrypt (PCR-bound)          │
                                  │  seal cards → seat X25519         │
                                  └───────────────────────────────────┘
```

**Local / Anvil:** `ENCLAVE_ATTESTATION_MODE=mock` runs the runtime in-process with a signed mock attestation document and mock KMS release. `productionTeeVerified` and `productionKms` are always `false`.

**Production:** requires AWS Nitro Enclaves + `nitro-cli` EIF build + published PCRs + KMS policy. The `NitroAttestationVerifier` stub refuses until COSE/PKI verification is wired.

---

## Attestation

### DealerBatchAttestation (Plan 05 / Randomness V2 §6)

```text
sessionId, epoch, dealerSecretRoot, vrfRequestId, vrfResultHash,
deckBatchRoot, randomnessPolicyHash, enclaveMeasurement, createdAt, signature
```

Digest domain: `MOZETTO_DEALER_BATCH_ATTESTATION_V1` (off-chain; not a frozen vector).

### Mock document

Structured fields + ECDSA over `MOZETTO_MOCK_NITRO_ATTESTATION_V1` digest. PCR0/1/2 must match `ApprovedMeasurementRegistry` (defaults in `src/constants.ts`).

### Nitro (production — not implemented)

- Raw NSM COSE Sign1 document
- Verify against AWS Nitro Attestation PKI
- Extract PCRs + public key + userData
- Only then set `productionTeeVerified: true`

---

## Private card delivery API

```http
POST /internal/dealer/deliver-private-cards
```

Each seat supplies an X25519 public key. Hole cards are AES-256-GCM sealed with ECDH; other seats cannot decrypt. Board cards use `open-public-card` (public Merkle openings from WP-051).

Full Plan 05 surface:

| Method | Path |
|---|---|
| POST | `/internal/dealer/commit-batch` |
| POST | `/internal/dealer/bind-vrf` |
| POST | `/internal/dealer/prepare-decks` |
| POST | `/internal/dealer/open-public-card` |
| POST | `/internal/dealer/deliver-private-cards` |
| GET | `/internal/dealer/attestation/:session/:epoch` |

Default mock listen port: `4013` (`DEALER_ENCLAVE_PORT`).

---

## KMS policy

Mock: `MockKmsDealerGateway.releaseDealerKey` gates on verified mock attestation + approved measurement.

Production shape (documentation only — `describeProductionKmsPolicy`):

```json
{
  "conditions": {
    "kms:RecipientAttestation:ImageSha384": "<PCR0 from describe-eif>",
    "kms:RecipientAttestation:PCR1": "<PCR1>",
    "kms:RecipientAttestation:PCR2": "<PCR2>"
  }
}
```

---

## What requires real AWS Nitro

| Capability | Mock (this packet) | Needs AWS Nitro |
|---|---|---|
| Attestation verify API | ✅ mock | ✅ live NSM + PKI |
| Approved PCR registry | ✅ fixtures | ✅ `describe-eif` publish |
| DealerBatchAttestation | ✅ | ✅ signed inside EIF |
| Sealed private cards | ✅ | ✅ same crypto in EIF |
| KMS DEK release | ✅ in-process mock | ✅ KMS + PCR conditions |
| EIF / PCR measurements | ❌ stub scripts only | ✅ `nitro-cli build-enclave` |
| Claim “production TEE” | ❌ forbidden | ✅ only after live verify |

---

## Commands / evidence

```bash
pnpm --filter @mozetto/dealer-enclave test
pnpm --filter @mozetto/dealer-enclave typecheck

# Optional local mock server
ENCLAVE_ATTESTATION_MODE=mock pnpm --filter @mozetto/dealer-enclave start
```

EIF build (Nitro host only — exits 2 without `nitro-cli`):

```bash
bash services/dealer-enclave/nitro/build.sh
```

---

## Env

| Variable | Default | Notes |
|---|---|---|
| `ENCLAVE_ATTESTATION_MODE` | `mock` | `nitro` selects refusing stub |
| `ENCLAVE_SIGNING_PRIVATE_KEY` | Anvil #8 | Local only |
| `DEALER_ENCLAVE_PORT` | `4013` | Mock HTTP |

---

## Out of scope / follow-up

| Item | Notes |
|---|---|
| Live Chainlink / beacon wiring | WP-050/053 (done separately) |
| Cut over `services/dealer` secrets into enclave | follow-up ops |
| Public Verify Game UI | WP-090 |
| Reproducible EIF CI on GitHub runners | needs Nitro hardware / dedicated builder |
| Spec mutations | forbidden |

**Security note:** Mock mode keeps dealer secret preimages in process memory. Production must load entropy only after KMS release inside the attested EIF; parent and DB store roots only.
