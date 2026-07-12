# Agentic Workspaces — non-tax bucket analysis

Date: 2026-07-11  
Vision source: Linear **Agentic Workspaces** product contract, runtime boundary,
delivery sequence 1–7, and non-negotiables. The standalone Tax Automation
Engine and Tax Agent are excluded from both numerator and denominator.

## Result

**Production parity: 80.1%.** The repository has strong contracts and a growing
durable runtime, but a contract or simulated gate is not counted as a shipped
provider, rendered client, production worker, or live evidence path.

| Must-have bucket | Weight | Proven completion | Weighted result | Authoritative evidence |
| --- | ---: | ---: | ---: | --- |
| Filesystem agents, durable DAG, approvals, native traces | 12 | 90% | 10.8 | Real Open Agents dispatch completed; workflow/trace suites pass. |
| Harness, MCP and Circle agent-wallet boundary | 13 | 80% | 10.4 | Fresh live certification passes Hermes, Codex, a terminal Open Agents dispatch, bufi-hyper and Circle read-only/spend-denial; Claude login and Computer Use TCC fail honestly. `@bufinance/intelligence@0.4.0` and the Eve binding expose the full Circle-compatible registry. |
| Canonical Postgres KG and transactional outbox | 15 | 82% | 12.3 | Live Neon proves atomic resolver/outbox, rollback, leases, stable cursors, two-tenant RLS, version-bound embedding/enrichment/search projection and immutable source/artifact lineage through no-bypass runtime roles. |
| BullMQ data plane and workload isolation | 12 | 82% | 9.8 | Real BullMQ/Redis tests prove global workspace slots, retries, permanent-error discard, deadlines, compact DLQ, crash recovery and concrete canonical, enrichment, embedding, projection and repair workers. An authenticated payload-free telemetry ingress and queue-SLO cockpit now pass end to end on a protected Vercel preview with live Neon persistence and idempotent replay; configured Upstash TCP readiness still fails. |
| Indexed retrieval, embeddings, Typesense freshness and quality | 10 | 95% | 9.5 | Live lexical GIN, pgvector HNSW, local Typesense 30.2 and the configured hosted Typesense provider pass; real AI Gateway embeddings, tenant isolation, stale-write rejection, combined recall ≥0.8, version-bound receipts, idempotent hosted upsert/retrieval and immutable ContextPacket persistence pass. Native client rendering and larger load/freshness repair remain open. |
| Connected Data Spine: Pipedream, ERP, Magic Inbox and lineage | 13 | 55% | 7.2 | Persistent deployments, atomic signed-event receipts, immutable source artifacts, safe artifact reads, a live concrete Neon→BullMQ processor pipeline and the merged Desk knowledge broker producer pass. Authorized live provider sandboxes remain absent. |
| Desk command center and pack composer | 10 | 85% | 8.5 | Desk PR #542 embeds the signed command center, pack composer, workflow timeline, approvals, traces, entity/evidence facets, verified ContextPacket citations/diffs and a Team Cockpit projection. Focused suites and a forced real Vercel preview build pass; authenticated browser E2E is still uncertified. |
| Expo/Cleo command center | 7 | 85% | 6.0 | Desk PR #544 implements concrete Cleo inbox screens, server-revalidated approval intents, strict deep links, trace summaries, Shiva bridge, push notifications and fail-closed verified ContextPacket citations/diffs. Expo web export and a clean external install/import of the public adapter pass; authenticated physical-device E2E remains open. |
| Horizontal operating packs and BUFI dogfood | 8 | 70% | 5.6 | Packs, policy, simulation, KPI definitions, durable runtime and Team Cockpit ownership/blocker/handoff projections exist. One week of connected cockpit evidence is not present. |
| **Total** | **100** |  | **80.1%** |  |

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
  exposing workspace, job payload or error detail. Its authenticated HTTPS
  ingress, ordered trace persistence and BUFI cockpit rendering now pass; live
  delivery from a deployed worker remains open.
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
- Desk PR #541 also exposes a membership-gated ContextPacket/citation resolver.
  It revalidates packet schema, SHA-256 integrity, citation/reference alignment,
  workspace/storage binding and requested `cN` handles before returning evidence.
  Four adapter tests and three route tests pass; unknown handles, tampering and
  cross-tenant access fail closed.
- The authenticated Open Agents `/operations` command center now lists recent
  owner-scoped runs, launches non-tax harness workflows, polls durable state and
  traces, shows the specialist roster and ContextPacket hashes, and exposes
  approval/rejection/cancellation controls. Its Desk workspace grant is accepted
  only at launch, encrypted with AES-256-GCM in a private run-bound table, opened
  just in time for broker calls, and deleted on completion, failure, rejection
  or cancellation. Workflow input and approval hooks no longer persist the raw
  grant or hook token. Migration 0051 is live and PUBLIC table privileges are
  revoked. Full CI passes 176 isolated files and 17 package typechecks.
- The command center's unauthenticated guard and full SSR layout were exercised
  locally. The macOS Computer Use pipe was unavailable, and the temporary
  headless client did not establish an authenticated hydrated session; therefore
  that earlier evidence alone was not a rendered Desk E2E claim.
- Desk PR #542 now supplies the cross-product command center and pack composer,
  including persisted run/trace/approval controls, a workflow timeline, explicit
  agent/human ownership, active blockers derived only from persisted facts,
  ontology/entity evidence facets and deterministic asynchronous handoffs.
  Twelve focused command-center/API tests pass. The Git-triggered Vercel status
  was initially a false positive because an ignored-build rule cancelled the
  app deployment; a forced deployment then built all ten dependent tasks, 299
  static pages, 26 workflow steps, four workflows and three classes and reached
  `READY`. Its unauthenticated workspace route redirects to login with a bounded
  return path, while an unscoped operations request fails 400. GitHub's Validate
  job did not start on an organization runner, and no authenticated session was
  available, so this is not counted as authenticated browser certification.
- Desk PR #544 now supplies a concrete Expo/Cleo workflow inbox, strict
  workspace-bound deep links, non-authoritative approval/edit intents for server
  revalidation, trace summaries, Shiva bridge and push registration/notification
  handling. Eight adapter tests, production Expo web export and Vercel previews
  pass; physical-device authenticated E2E remains open.
- `@bufinance/intelligence@0.4.0` is publicly installable with the full 17-tool
  Circle-compatible registry, and the matching `bu-intelligence-agent` Eve
  binding is merged. This supersedes the closed four-tool Desk PR #495 instead
  of duplicating a weaker wallet contract in the monorepo.
- A fresh live harness certification passes Hermes, Codex, an Open Agents
  dispatch through terminal completion, bufi-hyper Circle tool discovery and an
  existing Circle agent-wallet inventory/balance read. Mutation and spend remain
  denied without approval. Claude Code reports no authenticated login and
  CuaDriver reports missing Accessibility and Screen Recording TCC grants.
- A fresh hosted-infrastructure rerun passes ten live Neon/connector/RLS/search/
  pgvector/AI Gateway cases. The configured Upstash endpoint closes TLS before
  handshake, producing eight honest BullMQ/outbox/worker failures; local Redis
  success is not substituted for this production-provider failure.
- The configured hosted Typesense provider also passed a unique-collection live
  test: create, two idempotent upserts, tenant-filtered retrieval of exactly one
  document and cleanup. The larger recall/latency/freshness-repair load gate is
  still open.
- `@bufinance/open-agents-expo-adapter@0.1.0` is publicly visible and a clean
  temporary npm project installs and imports all five runtime exports. Its
  dist-only ESM/types/react-native package contains no source-workspace imports.
- Desk PR #542 now renders only membership-gated, hash-revalidated ContextPacket
  evidence. It shows bounded `[cN]` handles, snippets, confidence, evidence
  versions and graph/projection diffs, links each handle through the protected
  resolver and fails closed without hiding the workflow itself. The same route
  accepts a short-lived signed mobile grant, then still checks team membership.
  Ten focused route/component tests pass, and forced preview deployment
  `dpl_8qKbP3RNzKXXQxZCXUTGUEKFzoQq` reached `READY`.
- Desk PR #544 now extracts packet hashes from persisted workflow traces, asks
  Shiva for a user/team-revalidated five-minute grant, forwards only that grant
  to Desk and renders the same bounded citation/confidence/version/diff
  semantics in Expo. Invalid or cross-workspace packets stay hidden. Four
  focused tests and a fresh production Expo web export pass.
- Queue workers can now turn BullMQ facts into a hash-bound snapshot containing
  only aggregate latency, retry, dead-letter, throttle and in-flight metrics.
  The HTTPS sink requires a 32-byte service secret, a ten-second timeout and a
  validated acknowledgement. Open Agents authenticates and revalidates the
  snapshot before appending `queue.telemetry` to the bound workspace/run. A
  Postgres advisory lock allocates one ordered trace sequence under concurrent
  exporters and makes export-ID replay idempotent. The operations cockpit shows
  queue/process p95, retries, dead letters and SLO alerts while malformed trace
  data stays hidden. Nine focused tests, both package/app typechecks and a live
  Neon concurrency/tenant-mismatch test pass.
- The repeatable `queue:certify:hosted` harness created a temporary real
  operating-pack run in Neon and delivered one integrity-bound snapshot through
  protected preview deployment `dpl_Gg7YQdjYVhy2V9jwGAHfZ2UtH5dX`. The first
  request returned `accepted=true`, `replayed=false`, sequence 2; an exact second
  delivery returned `replayed=true` at the same sequence. Neon contained exactly
  one `queue.telemetry` trace with three SLO alerts, and the persisted data
  contained neither the synthetic job ID nor provider error detail. The fixture
  was deleted after certification.

## Must-have gaps before 100%

1. Replace or repair the configured Redis/Upstash TCP provider and run the same
   mixed workload against that production target. A local isolated Redis pass is
   evidence for the runtime, not the hosted provider.
2. Deploy the outbox relay and concrete workers, wire them to the now-shipped
   authenticated queue-telemetry ingress, then repeat crash-after-effect against
   the hosted alternate-index provider and deployed worker topology. The
   payload-free exporter, protected hosted ingress, ordered live-Neon trace
   persistence and cockpit rendering pass; deployed worker delivery and an
   external alert channel remain open.
3. Run clean migration replay, multi-tenant load, larger combined-recall and
   latency benchmarks, scheduled freshness repair and Redis/worker kill-restart
   certification.
4. Connect real Pipedream, Magic Inbox, QuickBooks/Xero/Conta Azul and at least
   one authorized ERP sandbox through the shared artifact/effect path.
5. Browser-test the embedded Desk command center and pack composer end to end:
   launch, approval/rejection, cancellation, traces and the now-implemented
   citation resolver with a real authenticated signed Desk grant. Focused tests
   and a real preview pass, but the authenticated cross-product browser journey
   remains uncertified.
6. Device-test the implemented Expo/Cleo inbox, approvals, deep links and push
   notifications against the same authenticated APIs.
7. Fund/configure Claude Code or its Vercel AI Gateway key, and grant macOS
   Accessibility + Screen Recording so the complete harness matrix can pass.
8. Attach a real BUFI internal operating-week report with three durable
   workflows, five evidence-backed KPIs, traces and no autonomous spend.
9. Complete the authenticated hosted citation journey: resolve one real packet
   through the signed Desk browser session and the Shiva mobile-grant path, then
   capture physical-device evidence. Desk and Expo now render the same bounded
   handles, confidence, evidence versions and graph/projection diffs; only the
   live authenticated request evidence remains uncertified.

## Bucket verdict

The architecture is coherent and the new KG/queue slice moves two major buckets
from reference contracts to real infrastructure. **100% parity is not yet true**;
BU-214/216/218–231/276/277/279/280 must remain open or in review until their
live and rendered acceptance criteria are demonstrated.
