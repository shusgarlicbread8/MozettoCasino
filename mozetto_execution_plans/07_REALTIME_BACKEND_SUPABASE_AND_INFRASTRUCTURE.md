# 07 — Realtime Backend, Supabase, and Infrastructure

**Entry gate:** Canonical event protocol and session lifecycle are frozen.  
**Exit gate:** A table survives gateway/process failures without divergent state, and Supabase cannot authoritatively alter money or poker outcomes.

## Service topology

```text
apps/web
apps/admin
services/api
services/matchmaker
services/game-gateway
services/game-orchestrator
services/agent-runtime
services/dealer
services/replay-verifier
services/chain-indexer
services/settlement-worker
services/checkpoint-publisher
```

The current combined services may be split gradually. The authority boundaries matter more than the number of deployables.

## Authority model

| Concern | Authority |
|---|---|
| wallet funds/locks | Base contracts |
| active table sequencing | exactly one table actor |
| poker legality | canonical poker core |
| private deck/cards | confidential dealer |
| AI choice | agent runtime, validated by poker core |
| lobby/read UI | Supabase projections |
| transient queue/leases | Redis |
| settlement | verifier policy + Base contract |

## Table actor pattern

Each active table has exactly one logical writer.

Responsibilities:

- own in-memory state;
- request/decrypt legal private observation;
- call controller;
- enforce deadline;
- validate action through engine;
- persist canonical event before broadcast;
- update snapshots;
- trigger next actor/street;
- recover from last durable event.

Use a lease in Redis or another coordinator:

```text
tableId
actorInstanceId
leaseVersion
expiresAt
```

A second process may not act unless it acquires a newer lease and reconstructs state.

## Persistence rule

For every canonical event:

```text
BEGIN DB TRANSACTION
  insert canonical event
  update table/hand snapshot
  append transactional-outbox message
COMMIT
publish outbox message
```

Never broadcast an authoritative event before durable persistence.

## Event store

Tables:

```text
canonical_game_events
hand_snapshots
table_snapshots
private_event_commitments
public_event_payloads
broadcast_outbox
controller_invocations
```

Store public payloads separately from encrypted private payloads/commitments.

## WebSocket channels

Dedicated game WebSocket service:

```text
table:<id>:public
table:<id>:seat:<arenaAccount>
table:<id>:spectator-delayed
user:<id>:lifecycle
```

Messages include:

```text
sessionId
handId
sequence
eventHash
server monotonic timestamp
payload schema version
```

Clients detect gaps and request replay from a sequence number.

## Supabase role

Use Supabase for:

- auth identity and profiles;
- matchmaking intent persistence;
- public table/lobby projections;
- ratings;
- notifications;
- hand history metadata;
- admin read models;
- chain-indexed mirrors;
- proof package metadata.

Do not use Supabase client writes for:

- poker actions;
- private cards;
- authoritative stack mutation;
- real deposit crediting;
- session settlement;
- withdrawals.

Use Supabase Realtime Broadcast/Presence for non-authoritative lobby and notification experiences. Do not use Postgres Changes as the main game loop.

## Redis role

- matchmaking queues;
- table-actor leases;
- action timers;
- idempotency windows;
- rate limits;
- short-lived session caches;
- provider concurrency budgets.

Redis is not the permanent event log. A Redis loss may reduce availability but must not corrupt a hand.

## Recovery

### Game gateway dies

Clients reconnect to another gateway and request current snapshot + events after last sequence.

### Table actor dies

- lease expires;
- new actor acquires lease;
- loads latest snapshot;
- replays subsequent canonical events;
- confirms state hash;
- resumes timer according to recovery policy.

Never let two actors both continue.

### Database temporary failure

Pause action advancement. Do not continue a real-money hand without durable event persistence.

### Redis failure

Rebuild queues/leases from Postgres and active service heartbeats. Table actor must refuse action if lease certainty is lost.

### RPC failure

Gameplay may continue only within an already active, fully funded session and within checkpoint risk policy. New sessions and settlements pause until redundant RPC health returns.

## Deployment

### Web

Vercel is acceptable for the Next.js application.

### Long-running services

Use containers on a platform suited to persistent WebSockets and workers, such as ECS/Fargate, Kubernetes, Fly.io, or equivalent. Render can support staging but should not become an unexamined production assumption.

### Datastores

- Supabase managed Postgres;
- managed Redis with replication;
- object storage for encrypted transcripts/proof packages;
- separate staging and production projects.

## Environments

Never share:

- databases;
- Redis;
- signing keys;
- KMS keys;
- RPC credentials;
- chain manifests;
- storage buckets;
- Groq credentials

between Anvil/dev, Sepolia/staging, and Mainnet/production.

## Observability

### Per service

- request rate;
- error rate;
- p50/p95/p99 latency;
- open connections;
- restart count;
- queue depth;
- memory/CPU;
- deployment version.

### Game

- active tables;
- events/sec;
- action timeouts;
- state recovery count;
- duplicate actor attempts;
- sequence gaps;
- snapshot lag;
- divergence alerts.

### Chain

- indexer head/lag;
- RPC disagreement;
- pending relayer tx;
- settlement age;
- checkpoint age;
- gas spent;
- reorg count.

### AI

Covered in Plans 8–9, but feed all SLOs into central monitoring.

## Suggested SLOs for testnet hardening

- no canonical event loss;
- no divergent table state;
- 99.9% public WebSocket event delivery within target latency after persistence;
- table recovery within a documented upper bound;
- indexer lag alert within seconds;
- settlement backlog alert based on league risk;
- no unexplained vault reconciliation difference.

Do not advertise mainnet SLOs until measured under load.

## Load testing

Simulate:

- thousands of idle connected spectators;
- hundreds/thousands of concurrent tables;
- burst matchmaking;
- slow clients;
- reconnect storms;
- AI latency spikes;
- settlement batches;
- proof-batch publication;
- full indexer replay.

Measure and document maximum safe concurrency per deployment size.

## Acceptance checklist

- [ ] Exactly one writer per table.
- [ ] Persist-before-broadcast enforced.
- [ ] Reconnect/replay works from arbitrary sequence.
- [ ] Supabase is projection, not money/game authority.
- [ ] Redis loss does not corrupt canonical state.
- [ ] Chain indexer can rebuild from deployment block.
- [ ] Services have health/readiness endpoints.
- [ ] Hosted staging survives controlled component restarts.
