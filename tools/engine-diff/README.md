# Engine differential harness (WP-034 / WP-109)

Compares TypeScript NLHE (`packages/game-rules`) vs Rust `poker-core`
outcomes and state hashes. PokerKit is a **mandatory** third oracle in CI
(`--require-pokerkit`).

```bash
# Fixtures only (TS ↔ Rust)
pnpm test:engine-diff

# + random streams (default 25)
pnpm test:engine-diff:random

# + PokerKit required (CI path)
pnpm test:engine-diff:full

# Nightly: ~400 streams × up to 60 actions → thousands of states + PokerKit
pnpm test:engine-diff:nightly
```

Install PokerKit: see `tools/pokerkit-oracle/README.md`.
