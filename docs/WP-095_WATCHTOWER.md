# WP-095 — Watchtower prototype

**Authority:** Plans 10 / 13; `mozetto_execution_plans/16_AGENT_WORK_PACKETS.md` WP-095  
**Consumes:** `@mozetto/root-builder`, `@mozetto/randomness-verifier`, `@mozetto/proof-batch-publisher` (inclusion helpers), public ProofBatchRegistry views  
**Date:** 2026-08-07

---

## Delivered

| Item | Location |
|---|---|
| Package `@mozetto/watchtower` | `packages/watchtower` |
| Public package types + status categories | `src/types.ts` |
| Proof-batch rebuild / continuity / inclusion | `src/verify-batch.ts` |
| Balance root + Merkle inclusion + conservation | `src/verify-balance.ts` |
| Randomness golden / openings | `src/verify-randomness.ts` |
| Read-only batch sources (memory + viem views) | `src/sources.ts` |
| Offline fixtures from frozen vectors | `src/fixtures.ts` |
| Orchestrator + health report | `src/run.ts` / `src/report.ts` |
| CLI (`mozetto-watchtower`) | `src/cli.ts` (`pnpm watchtower`) |
| Unit tests | `src/watchtower.test.ts` |
| This note | `docs/WP-095_WATCHTOWER.md` |

Frozen `/specs` untouched. **No operator / publisher private keys** — verification is read-only over public data and content-addressed packages.

---

## Goal

Independent consumer of public chain/data that verifies proof batches, balance roots, and randomness openings **without trusting Mozetto operators**.

```text
PublicVerifyPackage / ProofBatchRegistry views / golden vectors
        ↓
   @mozetto/watchtower
        ↓
  WatchtowerReport { status, checks[], ok }
```

---

## Public result categories (Plan 10)

| Status | Meaning |
|---|---|
| `VERIFIED` | All substantive public checks passed |
| `VERIFIED_WITH_ATTESTED_PRIVATE_DEALER` | Verified; private dealer path attested |
| `PENDING_BASE_ANCHOR` | Package not yet matched to a Base anchor |
| `PENDING_SETTLEMENT` | Settlement not anchored / flagged pending |
| `INCOMPLETE_PUBLIC_DATA` | Nothing substantive to verify |
| `VERIFICATION_FAILED` | At least one check failed |

Never promote to `VERIFIED` when a required component is pending or missing.

---

## What it verifies (where data exists)

1. **Proof batch** — rebuild `globalRoot` / `proofBatchHash` from ordered checkpoint roots (`@mozetto/root-builder`); optional self-inclusion proofs; optional match against a read-only registry source (`MemoryBatchSource` or viem `eth_call` views).
2. **Continuity** — sequence +1; `previousBatchRoot == prior.globalRoot`; genesis `previousBatchRoot == 0`; unique `globalRoot` in the walk.
3. **Balances** — rebuild seat-ordered `balanceRoot`; emergency-exit style leaf Merkle inclusion.
4. **Settlement conservation** — `openingTotal == endingPlayerTotal + totalRake` (arithmetic only; no attestor keys).
5. **Randomness** — golden MOZETTO_RANDOMNESS_V2 suite + optional public card openings via `@mozetto/randomness-verifier`.

Missing sections are **skipped** (not hard-fail) unless the run has zero substantive checks → `INCOMPLETE_PUBLIC_DATA`.

---

## Commands

```bash
# Offline health suite (vector 13 + balances + randomness) — default
pnpm watchtower
# equivalent:
pnpm --filter @mozetto/watchtower verify
pnpm --filter @mozetto/watchtower health

# Quiet one-line health
pnpm watchtower -- --quiet

# JSON report
pnpm watchtower -- --json /tmp/wp095.json

# Custom public package
pnpm watchtower -- --package path/to/public-package.json

# Package tests / typecheck
pnpm --filter @mozetto/watchtower test
pnpm --filter @mozetto/watchtower typecheck
```

Exit code `0` = PASS (`VERIFIED` / `VERIFIED_WITH_ATTESTED_PRIVATE_DEALER`), `1` otherwise.

---

## Library API

```ts
import {
  runWatchtower,
  MemoryBatchSource,
  createViemBatchSource,
  fixtureHealthSuite,
  formatReportText,
  type PublicVerifyPackage,
} from "@mozetto/watchtower";

const report = await runWatchtower({
  pkg: fixtureHealthSuite(),
  includeRandomnessGolden: true,
  // optional: batchSource: createViemBatchSource({ address, publicClient }),
});

console.log(formatReportText(report));
// report.status === "VERIFIED"
```

### Optional live registry (view-only)

```ts
import { createPublicClient, http } from "viem";
import { createViemBatchSource, runWatchtower } from "@mozetto/watchtower";

const publicClient = createPublicClient({ transport: http(RPC_URL) });
const batchSource = createViemBatchSource({
  address: PROOF_BATCH_REGISTRY_ADDRESS,
  publicClient,
});

await runWatchtower({ pkg, batchSource });
```

No wallet client. No publisher key.

---

## PublicVerifyPackage (shape)

```json
{
  "packageId": "optional-id",
  "proofBatch": {
    "sequence": "7",
    "previousBatchRoot": "0x…",
    "globalRoot": "0x…",
    "dataManifestHash": "0x…",
    "createdAt": "1723005000",
    "proofBatchHash": "0x…",
    "checkpointRoots": ["0x…", "0x…"],
    "checkpoints": [{ "sessionId": "0x…", "checkpointId": 0, "checkpointRoot": "0x…" }]
  },
  "batchChain": [],
  "balances": { "balanceRoot": "0x…", "leaves": [] },
  "balanceInclusion": { "leaf": {}, "balanceRoot": "0x…", "proof": [] },
  "settlement": {
    "openingTotal": "300000000",
    "endingPlayerTotal": "300000000",
    "totalRake": "0",
    "anchoredOnChain": true
  },
  "randomness": { "runGoldenSuite": true },
  "pending": { "baseAnchor": false, "settlement": false }
}
```

---

## Out of scope / follow-up

| Item | Notes |
|---|---|
| Spec mutations | Forbidden |
| Operator keys / attestor signing | Forbidden for this packet |
| Full WASM table replay | WP-064 / WP-090 |
| Public Verify Game UI | WP-090 |
| Persistent `watchtower_reports` DB | Plan 19 migration later |
| Continuous hosted watchtower service | Can wrap CLI/loop later |

---

## Wave gate

Independent verification of public roots/batches/randomness where data exists, with a clear pass/fail health report — exercised by `pnpm watchtower` and package unit tests.
