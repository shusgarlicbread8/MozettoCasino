# PokerKit oracle (mandatory under WP-109)

PokerKit is the **third differential oracle** for curated Hold'em settlement /
hand-eval scenarios. TypeScript and Rust remain the production engines;
PokerKit validates independent arithmetic.

**WP-109:** CI fails if PokerKit is missing when the engine-diff job runs
(`--require-pokerkit`). Local quick TS↔Rust fixture parity still works without
Python via `pnpm test:engine-diff`.

```bash
cd tools/pokerkit-oracle
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python run_scenarios.py

# From repo root — required path (fails if PokerKit missing):
pnpm test:engine-diff:full

# Nightly large generated set (thousands of states + required PokerKit):
pnpm test:engine-diff:nightly
```

See `docs/WP-109_POKER_RELEASE_HARDENING.md` and `docs/WP-034_DIFFERENTIAL_HARNESS.md`.
