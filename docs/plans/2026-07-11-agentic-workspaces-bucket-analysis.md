# Agentic Workspaces — non-tax bucket analysis

Date: 2026-07-11  
Vision source: Linear **Agentic Workspaces** product contract, runtime boundary,
delivery sequence 1–7, and non-negotiables. The standalone Tax Automation
Engine and Tax Agent are excluded from both numerator and denominator.

## Result

**Current conservative strict parity: 83.9%.** The repository has strong
contracts and a growing durable runtime, but a contract or simulated gate is
not counted as a shipped provider, rendered client, production worker, or live
evidence path. The July 11 baseline was 82.7%; the authenticated Desk browser
closure added 1.2 weighted points. External-provider, authenticated-mobile,
production-ceiling, wallet-executor, and harness gates below remain excluded
from a 100% claim.

| Must-have bucket | Weight | Proven completion | Weighted result | Authoritative evidence |
| --- | ---: | ---: | ---: | --- |
| Filesystem agents, durable DAG, approvals, native traces | 12 | 90% | 10.8 | Real Open Agents dispatch completed; workflow/trace suites pass. |
| Harness, MCP and Circle agent-wallet boundary | 13 | 80% | 10.4 | Fresh live certification passes Hermes, Codex, a terminal Open Agents dispatch, bufi-hyper and Circle read-only/spend-denial; Claude login and Computer Use TCC fail honestly. `@bufinance/intelligence@0.4.0` and the Eve binding expose the full Circle-compatible registry. |
| Canonical Postgres KG and transactional outbox | 15 | 82% | 12.3 | Live Neon proves atomic resolver/outbox, rollback, leases, stable cursors, two-tenant RLS, version-bound embedding/enrichment/search projection and immutable source/artifact lineage through no-bypass runtime roles. |
| BullMQ data plane and workload isolation | 12 | 99% | 11.9 | Real BullMQ tests against Railway Redis prove cross-replica workspace caps, noisy/protected tenant progress, retries, permanent-error discard, deadlines, compact DLQ, throttling and payload-free facts. A live three-boundary SIGKILL gate proves zero-loss recovery, a deployed worker delivered a real DLQ SLO alert into Eve, and hash-verified redrive rejects tampering then replays idempotently. Production resource saturation remains open. |
| Indexed retrieval, embeddings, Typesense freshness and quality | 10 | 96% | 9.6 | Live lexical GIN, pgvector HNSW, local Typesense 30.2 and the configured hosted Typesense provider pass; real AI Gateway embeddings, tenant isolation, stale-write rejection, combined recall ≥0.8, version-bound receipts, idempotent hosted upsert/retrieval, external-document repair and immutable ContextPacket persistence pass. Native client rendering, scheduled repair and larger load/freshness testing remain open. |
| Connected Data Spine: Pipedream, ERP, Magic Inbox and lineage | 13 | 55% | 7.2 | Persistent deployments, atomic signed-event receipts, immutable source artifacts, safe artifact reads, a live concrete Neon→BullMQ processor pipeline and the merged Desk knowledge broker producer pass. Authorized live provider sandboxes remain absent. |
| Desk command center and pack composer | 10 | 100% | 10.0 | Desk PR #542 embeds the signed command center, pack composer, workflow timeline, approvals, traces, entity/evidence facets, verified ContextPacket citations/diffs and a Team Cockpit projection. Authenticated browser E2E now proves launch, cancellation, approval rejection, timeline traces, and populated citation rendering; 19 focused tests and a forced real Vercel preview build pass. |
| Expo/Cleo command center | 7 | 88% | 6.2 | Desk PR #544 implements concrete Cleo inbox screens, server-revalidated approval intents, strict deep links, trace summaries, Shiva bridge, push notifications and fail-closed verified ContextPacket citations/diffs. Push tokens are now bound to the JWT user and a membership-revalidated selected workspace; six focused route/authorization tests, Expo web export and a clean external install/import of the public adapter pass. Authenticated physical-device E2E remains open. |
| Horizontal operating packs and BUFI dogfood | 8 | 70% | 5.6 | Packs, policy, simulation, KPI definitions, durable runtime and Team Cockpit ownership/blocker/handoff projections exist. One week of connected cockpit evidence is not present. |
| **Total** | **100** |  | **83.9%** |  |

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
  revoked.
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
- A fresh hosted-infrastructure rerun originally passed ten live Neon/connector/
  RLS/search/pgvector/AI Gateway cases while the former Upstash endpoint closed
  the TLS handshake. That endpoint is now retired from the worker path: Railway
  Redis passes the deployed relay, canonical-source and knowledge-AI
  certification. Provider saturation remains open; worker kill/recovery is now
  separately proven by the three-boundary live gate below.
- A reusable hosted kill-boundary gate ran through Railway Redis and the
  production Postgres knowledge constraint at three real boundaries: queued
  before claim, SIGKILL before effect and SIGKILL after effect before queue ACK.
  Every job completed after recovery; the replay kept the same entity identity
  at version 1, proving zero committed-job loss and zero duplicate effects.
  Unique queue/entity fixtures were removed after the run.
- The configured hosted Typesense provider also passed a unique-collection live
  test: create, two idempotent upserts, tenant-filtered retrieval of exactly one
  document and cleanup. The larger recall/latency/freshness-repair load gate is
  still open.
- The hosted worker-plane certifier now deletes the external Typesense document,
  enqueues the same lineage-complete `knowledge.repair` event twice and requires
  the deployed relay/knowledge-AI worker to restore the exact workspace/entity/
  input-hash projection through one published outbox event. The live run passed
  and removed all Postgres, index and probe-DLQ fixture state.
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
- Desk PR #544 now also binds push-token persistence exclusively to the verified
  JWT user and the explicitly selected workspace after a fresh membership check.
  Body-supplied user identity is rejected; registration waits for session and
  workspace context. Six focused route/authorization tests and repository
  pre-push gates pass at commit `3357cad66`.
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
- `apps/knowledge-worker` is now the explicit long-running process boundary,
  separate from Next.js. One image supports isolated relay, canonical-source and
  knowledge-AI deployments plus a guarded `all` dogfood mode. Relay workspaces
  are explicitly allowlisted instead of enumerated through a broad database
  credential; `/readyz` fails closed on Redis/worker degradation, a stale relay
  cycle or its latest safe error. Queue facts are bounded by workspace/run,
  retried without changing job semantics and optionally forwarded as
  payload-free SLO alerts. The Railway Docker image built successfully. A real
  process then ran in `all` mode against live Neon and isolated Redis; readiness
  reported both worker profiles healthy and a fresh successful relay cycle, and
  SIGINT performed a clean telemetry/runtime/database shutdown. Full CI now
  passes 178 isolated files and 18 package typechecks.
- Railway deployment `c3d2bd2c-2cc4-4e29-990b-1807ea0192b7` runs the isolated
  relay and deployment `045d547f-a09e-405d-8d8f-259af1cc2d2b` runs the
  canonical-source worker against Railway Redis. Both images passed `/readyz`.
  The repeatable `queue:certify:worker-plane` fixture committed one signed
  Pipedream/Magic-Inbox-shaped SourceArtifact to Neon, observed its outbox row
  published through the relay, observed a version-1 `SourceArtifact` entity
  created by the separate worker, and received three hosted queue traces with
  queued=1, completed=1 and no artifact key or storage reference. Cleanup left
  zero run, trace, entity and source-artifact rows. Protected Vercel delivery
  uses a validated server-only automation-bypass header; Deployment Protection
  remains enabled and neither secret is logged or persisted by the certifier.
- Railway deployment `08e50274-f9ba-440f-97dc-e24a86537898` runs the isolated
  knowledge-AI worker. The upgraded disposable certifier observed four published
  outbox stages and four hosted completions: canonical entity version 1,
  deterministic `pdf-document` enrichment, a 1,536-dimension AI Gateway
  embedding bound to source version 1, and a matching `workspace_knowledge`
  Typesense document plus Postgres projection receipt. Typesense 30.2 runs on a
  persistent Railway volume with a collection-scoped create/upsert key; the
  worker never receives the admin key. Cleanup left zero certification artifacts,
  entities, enrichments, embeddings, projections, outbox rows, runs and external
  documents. The diagnostic DLQ entry was purged after key rotation.
- The real mixed-workload integration also passed against Railway Redis: two
  runtime replicas processed 16 noisy connector pages, four protected canonical
  writes, a retryable provider failure, an unrecoverable provider record and a
  deadline path. Seventeen assertions proved the global per-workspace cap,
  protected-tenant completion, exact retry counts, compact hash-only DLQ,
  throttling/retry/dead-letter facts and no payload leakage. A separate live Neon
  outbox test simulated crash-after-enqueue-before-acknowledge; the next relay
  claim replayed the stable BullMQ job, processed exactly one entity and published
  the outbox row after two attempts. Both unique queue namespaces were purged.
- Railway Redis was then literally redeployed as deployment
  `815efdcd-d50c-4537-9ffa-9cd08c8c5cc8`. After the restart, relay readiness
  reported a fresh Redis connection, canonical-source reported its worker ready,
  and knowledge-AI reported its worker ready. The complete disposable four-stage
  certifier passed again after recovery (four published events, queued=4,
  completed=4, canonical/enrichment/1,536-dimension embedding/Typesense receipt)
  and cleaned all fixture state. This proves deployed reconnect and post-restart
  processing, not kill-at-every-commit-boundary persistence.
- Deployment `dpl_H3UTrezcAnHFsgkfYKz9D2iSZ3LG` added the protected, bounded
  `/api/internal/queue-alerts` ingress. A deployed Railway knowledge worker then
  dead-lettered a controlled missing-artifact repair, delivered
  `DEAD_LETTERS_PRESENT` through Vercel protection and persisted exactly one
  payload-free `queue.alert` Eve trace. The reusable certifier removed its
  entity, outbox, run and DLQ fixtures and exited zero on a second run.
- The real Railway Redis mixed-workload gate now exercises the complete compact
  DLQ lifecycle. Redrive requires the original versioned job envelope, verifies
  profile/workspace/queue identity and the stored SHA-256 payload hash, rejects a
  tampered payload, re-enqueues the stable BullMQ job once, removes the DLQ row
  and records a seven-day idempotency marker. Repeating the same redrive returns
  the same BullMQ ID with `replayed=true`; purge removes marker state.
- Desk PR #542 commit `376d31acb` closes the review-discovered broker scope and
  packet-storage defects. `knowledge_read` now requires `knowledge.read`, Circle
  balance reads require `agent-wallet.read`, and a mobile citation grant without
  knowledge scope is rejected before an admin client or membership query. Signed
  packets retain `sha256:<hex>` in the Open Agents contract while Desk persists
  and queries the table's required 64-hex key, then revalidates the full packet
  hash/workspace/storage binding on read. Fourteen broker/grant/packet tests and
  five resolver tests pass; the intelligence package typechecks. Forced Vercel
  deployment `dpl_8xhfT9gB74pmLNcJjMaxzxhCRFHP` built ten dependencies, 300
  pages, 26 steps/four workflows/three classes and reached READY. Browser
  verification proved the bounded unauthenticated login redirect. No existing Bu
  Desk session was available in the in-app browser and the Chrome extension was
  unavailable, so authenticated launch/approve/cancel remains unclaimed.

## Must-have gaps before 100%

1. Run production CPU/memory/DB/provider resource-saturation tests. A literal
   Railway Redis redeploy, recovery of all three worker modes, a full
   post-restart four-stage fixture and the three-boundary in-flight SIGKILL gate
   now pass; deployment-level saturation telemetry remains open.
2. Run the remaining production CPU/memory/DB/provider saturation matrix across
   the deployed worker profiles. Queue repair, alert delivery and DLQ redrive are
   now live-certified but do not substitute for resource-envelope evidence.
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

## Evidence addendum — 2026-07-12 10:55 UTC

The following fresh provider-backed gates now pass against the Railway worker
plane (credentials were used out-of-band and never persisted):

- `packages/knowledge/semantic.integration.test.ts`: 1 pass, 14 assertions;
  real AI Gateway embeddings, tenant isolation, stale-write rejection, HNSW
  index plan, and combined recall all passed.
- `packages/knowledge/search-projection.test.ts`: 4 pass, 15 assertions;
  real Typesense create/upsert/retrieval and tenant filtering passed.
- `packages/knowledge/postgres.integration.test.ts`: 8 pass, 46 assertions;
  live RLS, GIN recall with 2,000 filler entities, stable cursors, enrichment,
  context packets, leases/dead-letter, and payload rejection passed.
- Sixteen concurrent hosted worker-plane certifiers all exited zero. Each
  completed canonical write, deterministic enrichment, 1,536-dimensional
  embedding, Typesense projection, payload-free telemetry, and idempotent repair
  replay; every fixture was cleaned up. Railway `agentic-knowledge-ai` measured
  a 0.5197 CPU-unit maximum and 113.6 MB maximum memory in the 20-minute window
  (24 CPU units / 24,576 MB service limits). This is stronger bounded-envelope
  evidence, but it is still not a saturation or noisy-neighbor ceiling test.

These results close the semantic-provider and larger lexical-recall subgates;
they do not close authorized connector accounts, authenticated Desk/Expo
journeys, wallet-spend execution, or production saturation.

## Evidence addendum — 2026-07-12 Expo/Cleo simulator probe

The correct `apps/expo` entrypoint was rebuilt against an iPhone 16 Pro iOS
18.6 simulator. CocoaPods completed after the worktree installed its declared
`react-native-worklets` peer, and a direct `xcodebuild` simulator build passed
with zero errors. Runtime Metro bundling still fails closed: the Circle wallet
adapter graph imports the Node-only `node:util` module from
`@circle-fin/smart-contract-platform`, which cannot be bundled for React
Native. The earlier shared `node_modules` symlink also masked this until the
worktree was isolated. This is a real mobile packaging gap, not authenticated
device evidence; the Expo/Cleo bucket remains open until the client graph is
platform-safe and the protected workflow/citation journey is exercised.

## Evidence addendum — 2026-07-12 hosted workflow closure slice

The strict July 11 score remains **82.7%** until every bucket criterion is
remapped and re-scored; the following evidence is additive and does not turn
partial external-provider criteria into complete ones:

- Open Agents production deployment `dpl_HAxSnCsvYDvrSMBGSTdCdBCKKLY9` is
  READY at `https://open-agents-bay.vercel.app`. The production build passed
  migration, sandbox prewarm, workflow compilation, TypeScript, and static
  generation after Postgres persistence was isolated behind
  `apps/web/app/workflows/operating-pack-persistence.ts`.
- The live `/api/bufi/operations` route returns `401` unsigned and `200` for a
  disposable signed read-only grant, exposing the Agent Wallet/Circle catalog.
- A hosted `agent_wallet_service_discovery` run with the `pi` harness returned
  `202` and completed with durable `workflow.started`, `artifact.emitted`,
  `agent.started`, four `tool.called` events (including Circle service
  discovery input/output), `agent.completed`, `run.completed`, and mobile
  notification lifecycle traces. Temporary rows and bridge users were removed.
- A hosted high-risk `agent_wallet_payment` run accepted an explicit rejection
  at the approval boundary and reached `rejected` with `approval.requested`
  and `approval.rejected`; a separate run reached `cancelled` with
  `run.cancelled`. No wallet or payment mutation occurred.

These runs close the hosted durable workflow, trace, read-only tool-call,
approval-rejection, and cancellation evidence gates. They do not close real
wallet executor provisioning/approved spend, authorized connector sandboxes,
resource saturation, authenticated Desk browser/Expo device journeys, or the
internal operating-week report. The baseline therefore remains 82.7% rather
than claiming an unsupported 100%.

The authenticated Desk browser gate is now partially closed: PR #546 commit
`727ffaf17` fixes password-auth post-setup redirect, and Playwright observed a
disposable production-configured user reaching the wallet setup gate and
receiving HTTP `200` from `/api/agent-workspaces/grant`. This is authenticated
Desk evidence, but not a complete hosted browser launch/approve/cancel/trace
journey; Expo physical-device evidence and Desk type-debt remediation remain
open.

## Evidence addendum — 2026-07-12 worker flood and knowledge broker

The worker certifier gained bounded five-minute convergence controls and a
fresh 32-concurrent production flood completed **32/32** with zero failures,
zero missing results, and zero non-certified logs. Railway maxima during the
run were 0.5583 CPU units (24 available) and 0.1285 GB memory (24 GB
available). This materially strengthens the BullMQ/worker bucket, but remains
bounded-envelope evidence rather than an absolute DB/provider ceiling.

Open Agents production now calls the signed Desk broker for brokered tools. The
linked Desk Supabase project has the context-packet tables, and a fresh
finance-review workflow completed with persisted `knowledge_read` packet hashes.
An authenticated packet resolver returned HTTP 200 with 10 references and 10
citation handles. The selected finance citation-row browser assertion remains
open because disposable probes exhausted the preview sensitive-operation rate
limiter; no 100% claim is made.

## Fresh strict-gate delta — 2026-07-12

The authenticated fixed-preview Desk browser run now proves launch, approval
rejection, cancellation, timeline traces, and populated citation rendering.
This closes the remaining authenticated command-center criteria in the Desk
bucket (weight 10), moving that bucket from 88% to 100% and adding **+1.2
weighted points** to the July 11 strict baseline: **83.9% conservative strict
parity**. This is not a completion claim. Expo/Cleo authenticated device and
push, authorized provider sandboxes, Circle executor/mutation, production
capacity ceilings, Claude/TCC, and operating-week evidence remain unproven and
continue to hold the overall bucket analysis below 100%.

## Strict-gate delta — telemetry export ledger and worker ceiling — 2026-07-12

The queue-telemetry diagnostic found and fixed a real non-tax persistence gap:
repair exports were incorrectly routed through the operating-pack run table.
Commit `ef196076` adds an isolated, redacted `queue_telemetry_exports` ledger
with migration `0053_queue_telemetry_exports`; route tests, TypeScript, and the
production build passed. The hosted worker certifier is green at controlled
load (1/1), and the fresh five-minute 64-way ceiling probe improved from 61/64
to **62/64**. This strengthens the BullMQ/knowledge-worker bucket but does not
close its production-ceiling criterion: two certifiers still missed initial
convergence, and telemetry delivery pressure remains visible at the ceiling.
The conservative strict score therefore stays **83.9%**, with no unsupported
weighted-point increase.

The telemetry sender optimization was measured but not promoted as a parity
claim: budget 8 passed 32/32 and mixed 64-way floods (59/64, 60/64), after
which production returned to a conservative single-sender default. The
BullMQ/worker bucket therefore remains below 100% until a repeatable, classified
production ceiling and multi-tenant fairness result is proven.

## Agent-wallet tool parity addendum — 2026-07-13

The reopened BU-207 implementation was consolidated from Desk PR #548 into
`codex/bu-542-gateman-remediation` (commits `0a0700bdd`, `72c68be1e`,
`47bfaeb13`). The package now exposes the four Circle-compatible agent-wallet
tools and registry metadata with actor binding, wallet hard walls, bounded
atomic inputs, SSRF-safe x402 URLs, exact discovery-before-payment, deterministic
command IDs, approval/ambiguous-write outcomes, and an explicit unavailable
adapter default. Focused tests pass **19/19 (59 assertions)**, plus package
TypeScript and Biome. This closes the code-parity gap but not the live Circle/
Shiva adapter or approved wallet mutation gate, so no weighted score increase is
claimed.

## Agent-wallet live gateway slice — 2026-07-13

Desk PR #553, commit `80158daac`, now injects a server-bound Circle adapter into
the authenticated completion and audio gateways. The adapter resolves only the
workspace row marked `wallet_purpose='agent'`, calls the existing Circle
`WalletService` balance path, converts exact decimal balances to atomic units,
and exposes no model-selected wallet ID or credential. Transfer and x402 payment
calls return an explicit `approval_required` result without dispatch; the
existing HITL/multisig executor remains the required next boundary. Service
discovery remains an explicit unavailable result until a configured x402
directory adapter is authorized.

The adapter test plus the existing agent-wallet, wallet-guard, and gateway
suites pass **27/27 (81 assertions)**; intelligence typecheck and Desk
pre-push gates pass. The implementation commit's app typecheck passed; the
follow-up dependency-injection-only test refactor is covered by the Bun suite.
This closes the authenticated Desk tool-injection criterion
and strengthens the wallet-read path, but does not close live service discovery,
approved Circle mutation/spend, or the overall 100% gates.

## Expo/Cleo Metro graph remediation — 2026-07-13

Desk branch `codex/bu-544-gateman-remediation`, commit `403ee14db`, defers the
Circle modular client import in `workspace-wallet-setup.service.ts` until the
native allowlist reconciliation path is invoked. Fresh Expo production exports
now pass for both iOS and Android (56.5 MB Hermes bundles each), removing the
Node-only Circle graph from the initial Metro bundle. This closes the mobile
packaging subgate; authenticated device, push, approval, and deep-link journey
evidence remain open.

## Fresh hosted worker ceiling probe — 2026-07-13

Using the Railway production worker's configured Typesense endpoint/key only in
child-process environment, 32 disposable `certify-hosted-worker-plane` runs
were launched concurrently. **24/32 converged; 8/32 hit the initial
four-stage convergence deadline.** The failed runs reported only the bounded
deadline and the certifier's `finally` cleanup path remained active. This is
real current backpressure evidence, not a pass and not CPU/memory saturation
evidence. The production capacity/fairness gate remains open and the strict
score remains **83.9%**.
