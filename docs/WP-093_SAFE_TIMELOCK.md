# WP-093 — Safe / Timelock proposal integration

**Authority:** `mozetto_execution_plans/13_ADMIN_GOVERNANCE_SECURITY_AND_OPERATIONS.md`, `16_AGENT_WORK_PACKETS.md` WP-093  
**Depends on:** Ownable + contract-internal `minDelay` patterns (GameRegistryV2, ProtocolFeeVault, ProofBatchRegistryV1); admin app scaffold  
**Date:** 2026-08-07

---

## Delivered

| Item | Location |
|---|---|
| Calldata builders + action catalog | `packages/governance/` (`@mozetto/governance`) |
| Safe Transaction Builder JSON helpers | `packages/governance/src/safe.ts`, `proposal.ts` |
| OZ TimelockController wrap (schedule/execute) | `packages/governance/src/timelock.ts` |
| Mock / local Protocol + Treasury Safe | `packages/governance/src/mock-safe.ts` |
| CLI (no private keys) | `pnpm --filter @mozetto/governance propose` |
| Admin UI | `apps/admin/src/app/governance/` |
| Unit tests (encoding) | `packages/governance/src/encode.test.ts` |
| This note | `docs/WP-093_SAFE_TIMELOCK.md` |

**Invariant:** Admin browser and CLI builders never load operator private keys. Signing happens in Safe UI, hardware wallets, or offline tooling.

---

## Governance flow (Plan 13)

```text
proposal (this packet)
  → Safe approval (3-of-5 production target)
  → optional TimelockController delay
  → execution
  → (many contracts) second contract-internal minDelay before execute*
```

Roles:

| Role | Purpose |
|---|---|
| Protocol Safe | upgrades, registry, verifier policy, treasury config |
| TimelockController | optional outer delay when it owns contracts |
| Contract `minDelay` | GameRegistry activate/deactivate; FeeVault treasury; ProofBatch publisher |
| Treasury Safe | receive protocol revenue only |
| Emergency Guardian | pause / emergency deactivate — not fee redirect |

---

## Package API

```ts
import {
  encodeOwnerAction,
  buildGovernanceProposal,
  ACTION_CATALOG,
  createMockProtocolSafe,
  mockSafePropose,
} from "@mozetto/governance";

const proposal = buildGovernanceProposal({
  actionId: "protocolFeeVault.scheduleTreasuryUpdate",
  to: feeVault,
  args: { newTreasury: treasurySafe },
  chainId: 84532,
  mode: "direct", // or "timelockController" + timelockAddress + timelockDelaySec
});

// proposal.safeTxBuilder → import into app.safe.global Transaction Builder
// proposal.containsPrivateKeys === false
```

Critical actions covered include:

- Ownable `transferOwnership`
- GameRegistryV2 schedule/execute/cancel activation & deactivation, `setMinDelay`, guardian
- ProtocolFeeVault treasury schedule/execute/cancel, sweep, depositor, delays
- ProofBatchRegistry publisher schedule/execute/cancel
- ArenaVault pause/unpause + hub/treasury/relayer setters
- VerifierRouter / SignatureQuorumVerifier / SettlementHubV3 policy setters
- Raw TimelockController `schedule` / `execute` / `cancel`

---

## Admin UI

Path: `/governance` (nav: Governance)

- Select action → fill args → **Build proposal JSON**
- Copy Safe Transaction Builder batch
- Local mock receipt shows `awaiting_signatures` with threshold instructions
- Addresses from chain-manifest + optional env:
  - `PROTOCOL_SAFE_ADDRESS`
  - `TREASURY_SAFE_ADDRESS`
  - `TIMELOCK_CONTROLLER_ADDRESS`

When env Safe addresses are unset, mock local addresses are used (`MOCK_PROTOCOL_SAFE` / `MOCK_TREASURY_SAFE`). These are **not** mainnet deployments.

---

## CLI

```bash
pnpm --filter @mozetto/governance propose -- \
  --action gameRegistry.setMinDelay \
  --to 0x… \
  --arg newDelay=172800 \
  --chain-id 31337 \
  --mock-receipt

# Via TimelockController
pnpm --filter @mozetto/governance propose -- \
  --action arenaVault.pause \
  --to 0x… \
  --mode timelockController \
  --timelock 0x… \
  --delay 86400
```

Omit `--to` when the chain-manifest already has the target address for that action.

---

## Tests / evidence

```bash
pnpm --filter @mozetto/governance test
pnpm --filter @mozetto/governance typecheck
pnpm --filter @mozetto/admin typecheck
```

Encoding tests decode viem calldata for Ownable, GameRegistry, ProtocolFeeVault, and TimelockController wraps; assert proposal JSON never sets `containsPrivateKeys` and rejects `PRIVATE_KEY=` blobs.

---

## Out of scope / intentional deferrals

- Real mainnet Safe deploy (ops / WP-105)
- Browser wallet connect / in-page signing
- Spec mutations
- Secrets in repo
- Full Safe Transaction Service API integration (queue via UI/CLI outside admin)
- Deploying OpenZeppelin TimelockController in Anvil `DeployLocal` (env wire-up only)

---

## Follow-up

- WP-094 RBAC / audit log when proposals are recorded server-side
- Production Safe + TimelockController addresses in chain-manifest after Sepolia/mainnet deploy
- Optional server-side proposal archive (immutable audit) without storing keys
