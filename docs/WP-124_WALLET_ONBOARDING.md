# WP-124 — Wallet / onboarding (ArenaAccount)

**Authority:** Plan `20_PRODUCT_UI_AND_3D_PRESENTATION_PLAN.md` (Plan 20A), packet `16_AGENT_WORK_PACKETS.md` WP-124, PROGRESS Wave 12, design system `docs/WP-120_PRODUCT_IA_DESIGN.md`  
**Date:** 2026-08-07  
**Status:** DONE

---

## Delivered

| Item | Location |
|---|---|
| Wallet dashboard (Available / At Tables / Settling / Total) | `apps/web/src/app/(app)/wallet/page.tsx` |
| Fund page (demo deposit + Arena Account address / test mint) | `apps/web/src/app/(app)/wallet/deposit/page.tsx` |
| Withdraw page (demo + ArenaAccount owner withdraw) | `apps/web/src/app/(app)/wallet/withdraw/page.tsx` |
| Test mUSDC onboarding | `apps/web/src/app/(app)/wallet/test-musdc/page.tsx` |
| ArenaAccount withdraw panel | `apps/web/src/components/wallet/ArenaWithdrawPanel.tsx` |
| Seamless Play panel (WP-120 tokens + caps) | `apps/web/src/components/PlayPermissionsPanel.tsx` |
| Test faucet panel tokens | `apps/web/src/components/TestMusdcPanel.tsx` |
| `arenaAccountAbi` | `apps/web/src/lib/wagmi.ts` |
| This note | `docs/WP-124_WALLET_ONBOARDING.md` |

No `/specs` mutations. No protocol field inventions. No secrets committed.

---

## Goal

Radically simpler wallet UX — **not** a centralized casino deposit feel. Clear ArenaAccount ownership + Seamless Play grant story:

1. **How much can I play with?** — Available / At Tables / Settling / Total  
2. **How do I fund / leave?** — Fund address or test mint; owner-only withdraw  
3. **What can Mozetto do?** — Seamless Play caps only; **cannot withdraw available funds**

---

## Layout

1. **Hero** — Arena Account (or demo) framing; Available · At Tables · Settling · Total; Fund / Withdraw / Play Now  
2. **Security** — Seamless Play: enabled, max single game, max at risk, expiry, revoke  
3. **At tables** — live sessions from `/v1/wallet` (honest empty)  
4. **Legacy** — V1 vault idle only when `legacyMozetto > 0`  
5. **Activity** — ledger slice (honest empty)

---

## Data wiring

| Surface | Source | Empty / loading |
|---|---|---|
| Available | `useMozettoBalances` Arena ERC-20 / demo `/v1/me` | `…` while loading |
| At tables | live seat stacks (`displayLocked`) | $0 + empty session list |
| Settling | vault lock after leave | hidden when zero |
| Total | available + at tables (+ settling + legacy on-chain) | `…` while loading |
| Seamless Play | `GET /v1/arena/play-status` · `POST /v1/arena/game-permission` | Retry empty on API failure |
| Fund (demo) | `POST /v1/wallet/deposit` | error message |
| Fund (Anvil) | `POST /v1/arena/fund-test` | chain-gated copy |
| Fund (Sepolia+) | copy Arena Account address | address unavailable copy |
| Withdraw (demo) | `POST /v1/wallet/withdraw` | error message |
| Withdraw (on-chain) | `ArenaAccount.withdraw` via wagmi | Arena not ready / wrong wallet |

---

## Custody story (product copy)

- Idle funds live in the **user’s Arena Account**, not Mozetto.  
- **Seamless Play** is a capped GamePermission: enter ranked games only.  
- Mozetto **cannot** withdraw available funds or raise limits.  
- Owner withdraws idle tokens with `ArenaAccount.withdraw` to their EOA.

---

## Out of scope

- Spec / protocol mutations  
- InstantPermission V1 revive (deprecated; legacy vault withdraw kept for residual idle)  
- Find Match overlay (WP-122) / live table polish (WP-125+)  
- Net-worth chart primary surface (removed from wallet hero for simplicity)

---

## Follow-up

- WP-125 Live table 2D  
- Migrate remaining Find Match chrome onto WP-120 tokens where still on legacy greens  
