# Agentic Workspaces — non-tax bucket analysis

Date: 2026-07-11  
Vision source: Linear **Agentic Workspaces** product contract, runtime boundary,
delivery sequence 1–7, and non-negotiables. The standalone Tax Automation
Engine and Tax Agent are excluded from both numerator and denominator.

## Result

**Production parity: 56.6%.** The repository has strong contracts and a growing
durable runtime, but a contract or simulated gate is not counted as a shipped
provider, rendered client, production worker, or live evidence path.

| Must-have bucket | Weight | Proven completion | Weighted result | Authoritative evidence |
| --- | ---: | ---: | ---: | --- |
| Filesystem agents, durable DAG, approvals, native traces | 12 | 90% | 10.8 | Real Open Agents dispatch completed; workflow/trace suites pass. |
| Harness, MCP and Circle agent-wallet boundary | 13 | 72% | 9.4 | Hermes, Codex, Open Agents, bufi-hyper and Circle read-only pass; Claude credits and Computer Use TCC fail honestly. |
| Canonical Postgres KG and transactional outbox | 15 | 72% | 10.8 | Live Neon test proves atomic resolver/outbox, rollback, leases, stable cursors and two-tenant RLS through no-bypass runtime roles. A signed connector artifact now reaches every durable stage through the real outbox. |
| BullMQ data plane and workload isolation | 12 | 68% | 8.2 | Real BullMQ/Redis tests prove global workspace slots across two runtimes, retries, permanent-error discard, deadlines, compact DLQ, safe trace facts, crash recovery and a four-stage connector pipeline. Configured Upstash TCP readiness currently fails. |
| Indexed retrieval, embeddings, Typesense freshness and quality | 10 | 30% | 3.0 | Ranking/freshness/gate contracts exist; no live index, recall corpus, query plan or repair worker is certified. |
| Connected Data Spine: Pipedream, ERP, Magic Inbox and lineage | 13 | 45% | 5.9 | Persistent deployments, atomic signed-event receipts, immutable source artifacts, lineage-safe metadata and a live Neon→BullMQ four-stage pipeline pass. Authorized live provider sandboxes remain absent. |
| Desk command center and pack composer | 10 | 20% | 2.0 | Typed projections exist. Concrete Desk workflow graph, console, grants, composer and approval operation are not rendered and E2E certified. |
| Expo/Cleo command center | 7 | 20% | 1.4 | A substantial adapter/projection exists. Concrete Expo screens, deep links, notifications and approval E2E are absent. |
| Horizontal operating packs and BUFI dogfood | 8 | 65% | 5.2 | Packs, policy, simulation, KPI definitions and durable runtime exist. One week of connected cockpit evidence is not present. |
| **Total** | **100** |  | **56.6%** |  |

## Newly proven in this pass

- Additive Postgres schema for `knowledge_entities` and `knowledge_outbox`.
- Composite tenant/idempotency constraints and bounded indexes.
- Forced RLS plus `SET LOCAL ROLE open_agents_knowledge_runtime`; this closes
  the Neon owner credential's `BYPASSRLS` behavior discovered by the live test.
- Atomic entity resolution and outbox append with idempotency-conflict rollback.
- `FOR UPDATE SKIP LOCKED` claims, expiring leases, bounded retries and explicit
  dead state.
- Stable `(millisecond-created-at, id)` cursor pagination; a live test caught and
  fixed PostgreSQL microsecond/JavaScript millisecond replay drift.
- Real BullMQ queues multiplexed by worker profile, preventing concurrency from
  multiplying once per logical queue.
- A Postgres-to-BullMQ relay with explicit topic routing, leases and replay-safe
  database acknowledgement; a live fault-injection test crashes after enqueue
  and proves the recovered relay does not process the job twice.
- Redis sorted-set workspace admission shared across runtime replicas, bounded
  deadlines with `AbortSignal`, retry classification, sanitized bounded DLQ and
  payload-free trace facts.
- Persistent connector deployments and HMAC event receipts protected by a
  dedicated forced-RLS `NOBYPASSRLS` runtime role.
- Atomic `INSERT ... ON CONFLICT` receipt consumption; concurrent deliveries of
  the same valid webhook produce one winner and one replay rejection.
- Compact deterministic artifact/revision IDs, immutable artifact conflict
  detection, metadata-only persistence and raw-body hashing instead of body
  storage.
- One transaction persists a source artifact and all manifest-selected outbox
  stages. A live Neon → isolated Redis/BullMQ test processed canonical-write,
  enrichment, embedding and projection, then observed an empty relay replay.

## Must-have gaps before 100%

1. Replace or repair the configured Redis/Upstash TCP provider and run the same
   mixed workload against that production target. A local isolated Redis pass is
   evidence for the runtime, not the hosted provider.
2. Deploy the outbox relay and replace certification processors with concrete
   canonical-write, enrichment, embedding, Typesense, projection and repair
   workers. Prove crash-after-effect against real business constraints.
3. Run clean migration replay, indexed query plans, multi-tenant load, retrieval
   recall, freshness repair and Redis/worker kill-restart certification.
4. Connect real Pipedream, Magic Inbox, QuickBooks/Xero/Conta Azul and at least
   one authorized ERP sandbox through the shared artifact/effect path.
5. Implement and browser-test concrete Desk command center, pack composer and
   team cockpit surfaces against the shared APIs.
6. Implement and device-test concrete Expo/Cleo inbox, approvals, deep links and
   notifications against the same APIs.
7. Fund/configure Claude Code or its Vercel AI Gateway key, and grant macOS
   Accessibility + Screen Recording so the complete harness matrix can pass.
8. Attach a real BUFI internal operating-week report with three durable
   workflows, five evidence-backed KPIs, traces and no autonomous spend.

## Bucket verdict

The architecture is coherent and the new KG/queue slice moves two major buckets
from reference contracts to real infrastructure. **100% parity is not yet true**;
BU-214/216/218–231/276/277/279/280 must remain open or in review until their
live and rendered acceptance criteria are demonstrated.
