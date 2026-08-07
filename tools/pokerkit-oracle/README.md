# PokerKit oracle (dev tooling)

PokerKit is used as a **reference oracle** to derive expected settlement
outcomes for curated Hold'em scenarios. Those expected values are baked into
TypeScript tests under `packages/game-rules` — CI does **not** need Python.

**WP-034:** Optional third oracle via `pnpm test:engine-diff:full` (or
`node tools/engine-diff/run.mjs --pokerkit`). If this venv / `pokerkit` is
missing, the differential harness skips PokerKit cleanly; TS↔Rust fixture
parity still runs. See `docs/WP-034_DIFFERENTIAL_HARNESS.md`.

```bash
python3 -m venv .venv
.venv/bin/pip install pokerkit
.venv/bin/python run_scenarios.py
```
