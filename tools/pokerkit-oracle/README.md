# PokerKit oracle (dev tooling)

PokerKit is used as a **reference oracle** to derive expected settlement
outcomes for curated Hold'em scenarios. Those expected values are baked into
TypeScript tests under `packages/game-rules` — CI does **not** need Python.

```bash
python3 -m venv .venv
.venv/bin/pip install pokerkit
.venv/bin/python run_scenarios.py
```
