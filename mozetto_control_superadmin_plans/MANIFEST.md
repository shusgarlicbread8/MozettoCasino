# Mozetto Control Plan Pack

Files:

1. `00_READ_ME_FIRST.md` — immutable principles and control taxonomy.
2. `01_MASTER_EXECUTION_ROADMAP.md` — ordered implementation phases.
3. `02_ADMIN_AUTH_AND_SECURITY.md` — SIWE, sessions, roles, step-up, break-glass.
4. `03_CONTROL_SHELL_AND_INFORMATION_ARCHITECTURE.md` — IA and UI primitives.
5. `04_COMMAND_CENTER_AND_OBSERVABILITY.md` — realtime operational overview.
6. `05_ECONOMICS_TREASURY_AND_PLAYER_PNL.md` — business/economic control plane.
7. `06_PLAYERS_ACCOUNTS_RISK_AND_SUPPORT.md` — player drilldown and safe risk controls.
8. `07_TABLE_SESSION_AND_MATCHMAKING_OPERATIONS.md` — live poker ops.
9. `08_AI_MODEL_AND_AGENT_OPERATIONS.md` — inference, profiles, Energy, policy operations.
10. `09_CHAIN_SOLVENCY_RANDOMNESS_PROOFS_AND_SETTLEMENT.md` — protocol operations.
11. `10_GOVERNANCE_AND_MUTATION_CONTROLS.md` — capability tiers and Safe/timelock proposals.
12. `11_INCIDENTS_SECURITY_AUDIT_AND_RUNBOOKS.md` — incident command and audit.
13. `12_DATA_API_AND_DATABASE_PLAN.md` — schemas, routes, read models.
14. `13_TESTING_DEPLOYMENT_AND_RELEASE.md` — release/security gates.
15. `14_AGENT_WORK_PACKETS.md` — agent-assignable packets.
16. `15_FINAL_DEFINITION_OF_DONE.md` — completion gate.

Recommended execution order:

```text
00 → 01 → MC-000/001
          ↓
       C1 Auth
          ↓
       C2 Shell
          ↓
  ┌───────┼────────┐
  C3      C4       C6/C7
Overview Economics Live/AI
  └───────┼────────┘
          ↓
     C8 Protocol Ops
          ↓
     C9 Governance
          ↓
    C10 Incidents
          ↓
      C11 Release
```
