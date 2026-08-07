# Engine differential harness (WP-034)

Compare TypeScript (`packages/game-rules`) vs Rust (`crates/poker-core`) NLHE
outcomes and state hashes. PokerKit is an **optional** third oracle.

See **`docs/WP-034_DIFFERENTIAL_HARNESS.md`**.

```bash
# From repo root
pnpm test:engine-diff

# + random legal streams + PokerKit (if installed)
node tools/engine-diff/run.mjs --random --pokerkit
```
