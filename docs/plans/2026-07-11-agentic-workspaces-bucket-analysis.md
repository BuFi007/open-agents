# Agentic Workspaces — non-tax bucket analysis

Date: 2026-07-11  
Vision source: Linear **Agentic Workspaces** product contract, runtime boundary,
delivery sequence 1–7, and non-negotiables. The standalone Tax Automation
Engine and Tax Agent are excluded from both numerator and denominator.

## Result

**Production parity: 66.4%.** The repository has strong contracts and a growing
durable runtime, but a contract or simulated gate is not counted as a shipped
provider, rendered client, production worker, or live evidence path.

| Must-have bucket | Weight | Proven completion | Weighted result | Authoritative evidence |
| --- | ---: | ---: | ---: | --- |
| Filesystem agents, durable DAG, approvals, native traces | 12 | 90% | 10.8 | Real Open Agents dispatch completed; workflow/trace suites pass. |
| Harness, MCP and Circle agent-wallet boundary | 13 | 72% | 9.4 | Hermes, Codex, Open Agents, bufi-hyper and Circle read-only pass; Claude credits and Computer Use TCC fail honestly. |
| Canonical Postgres KG and transactional outbox | 15 | 82% | 12.3 | Live Neon proves atomic resolver/outbox, rollback, leases, stable cursors, two-tenant RLS, version-bound embedding/enrichment/search projection and immutable source/artifact lineage through no-bypass runtime roles. |
| BullMQ data plane and workload isolation | 12 | 78% | 9.4 | Real BullMQ/Redis tests prove global workspace slots, retries, permanent-error discard, deadlines, compact DLQ, crash recovery and concrete canonical, enrichment, embedding, projection and repair workers. Configured Upstash TCP readiness currently fails. |
| Indexed retrieval, embeddings, Typesense freshness and quality | 10 | 88% | 8.8 | Live lexical GIN, pgvector HNSW and local Typesense 30.2 paths; real AI Gateway embeddings, tenant isolation, stale-write rejection, combined recall ≥0.8, version-bound receipts, idempotent Typesense upsert and immutable ContextPacket persistence pass. Desk now emits the exact run-bound packet contract and Open Agents validates it. Native client citation rendering and larger load/freshness repair remain open. |
| Connected Data Spine: Pipedream, ERP, Magic Inbox and lineage | 13 | 55% | 7.2 | Persistent deployments, atomic signed-event receipts, immutable source artifacts, safe artifact reads, a live concrete Neon→BullMQ processor pipeline and the merged Desk knowledge broker producer pass. Authorized live provider sandboxes remain absent. |
| Desk command center and pack composer | 10 | 20% | 2.0 | Typed projections exist. Concrete Desk workflow graph, console, grants, composer and approval operation are not rendered and E2E certified. |
| Expo/Cleo command center | 7 | 20% | 1.4 | A substantial adapter/projection exists. Concrete Expo screens, deep links, notifications and approval E2E are absent. |
| Horizontal operating packs and BUFI dogfood | 8 | 65% | 5.2 | Packs, policy, simulation, KPI definitions and durable runtime exist. One week of connected cockpit evidence is not present. |
| **Total** | **100** |  | **66.4%** |  |

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
- Tenant-scoped PostgreSQL lexical search with a stored generated `tsvector`
  and GIN index. The live five-query corpus achieved recall@3 of 1.0, hid the
  matching cross-tenant documents and proved the GIN plan is available.
- Explicit entity select lists replace `SELECT *`; the live rolling migration
  exposed a prepared-plan result-type failure when the generated search column
  appeared, and the stable projection fixes that deployment hazard.
- Forced-RLS pgvector projections keyed by entity, workspace, model and input
  version, with a composite entity/workspace foreign key and HNSW cosine index.
- Real `openai/text-embedding-3-small` calls through Vercel AI Gateway/OIDC;
  minimized entity inputs are hash-bound to the exact entity revision, stale
  writes fail closed and cross-tenant vectors are invisible.
- A concrete BullMQ embedding processor now fetches canonical entity truth,
  embeds it, performs the version-checked projection write and reports only
  safe hash/model/usage metadata. Live Neon → outbox → local Redis/BullMQ → AI
  Gateway → Neon projection and semantic query passed.
- Concrete canonical-write, deterministic enrichment, alternate search
  projection and repair processors replace the prior no-op certification
  handlers. Knowledge-AI routes now execute their canonical/enrichment
  dependencies idempotently instead of racing ahead of source truth.
- Tenant-scoped source-artifact reads expose only persisted safe metadata and
  use stable explicit SQL projections rather than migration-fragile `SELECT *`.
- `knowledge_enrichments` and `knowledge_search_projections` are version-bound
  to canonical entity truth, protected by forced RLS and strict database
  constraints, and reject stale writes and cross-tenant reads.
- A simulated crash after the external index accepted an upsert but before the
  projection receipt landed recovered through BullMQ: one external document,
  one receipt and one embedding remained after retry.
- Official Typesense 30.2 ran locally in Docker; the real provider upserted the
  same document twice and tenant-filtered retrieval returned exactly one result.
- A bounded, payload-free queue telemetry sink now aggregates p95 queue wait and
  processing latency, retries, dead letters, throttling and in-flight work by
  profile/queue. Configurable SLO evaluation emits structured alerts without
  exposing workspace, trace, job payload or error detail. It is library evidence
  only until a deployed worker exports the snapshots to the BUFI trace cockpit.
- Migration 0050 persists immutable ContextPackets behind forced RLS. Packet
  hashes are re-derived on write/read, exact replay is idempotent, cross-tenant
  access is invisible, and watermark/reference diffs are deterministic. Live
  Neon passed 8 tests and 46 assertions. Query/evidence budgets, duplicate
  references, evidence revisions and observed times fail closed.
- The operating-pack `knowledge_read` boundary no longer trusts arbitrary broker
  JSON: it revalidates the packet hash and requires workspace + workflow-run
  binding before the harness sees evidence. Tool trace events correlate the
  validated packet hash with the agent/run without copying snippets or payloads.
- Desk PR #541 adapts its richer KG retrieval result into the exact Open Agents
  packet/citation contract, persists schema v2 idempotently, and binds the hash
  to workspace, workflow, specialist agent and request trace. A direct
  cross-repository runtime check generated the packet in Desk and accepted it
  with Open Agents' real validator. Ten focused Desk tests pass; its intelligence
  package typechecks. Desk's full API shard remains red on pre-existing unrelated
  type debt and is not counted as a green application build.

## Must-have gaps before 100%

1. Replace or repair the configured Redis/Upstash TCP provider and run the same
   mixed workload against that production target. A local isolated Redis pass is
   evidence for the runtime, not the hosted provider.
2. Deploy the outbox relay and concrete workers, then repeat crash-after-effect
   against the hosted alternate-index provider and deployed worker topology;
   export the new queue SLO snapshots to the trace cockpit and alert channel.
3. Run clean migration replay, multi-tenant load, larger combined-recall and
   latency benchmarks, scheduled freshness repair and Redis/worker kill-restart
   certification.
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
9. Render ContextPacket citation handles/diffs identically in Desk and Expo and
   run the signed broker path against a deployed preview. The producer/consumer
   contract now passes directly across repositories, but client consumption and
   hosted request evidence remain uncertified.

## Bucket verdict

The architecture is coherent and the new KG/queue slice moves two major buckets
from reference contracts to real infrastructure. **100% parity is not yet true**;
BU-214/216/218–231/276/277/279/280 must remain open or in review until their
live and rendered acceptance criteria are demonstrated.
