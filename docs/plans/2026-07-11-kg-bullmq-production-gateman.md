# Gateman — Postgres KG + connector + BullMQ production slice

Date: 2026-07-11  
Scope: non-tax BU-218/219/220/221/222/223/229 production infrastructure slice,
including migrations 0049–0050, concrete knowledge processors and immutable
ContextPacket persistence.

## Verdict

**YES_WITH_FOLLOWUPS — MEDIUM risk.** The implementation is safe to review and
deploy behind migration/readiness gates. The synthetic connected-data pipeline
is certified; this is not a claim that the configured hosted Redis provider or
authorized provider sandboxes are production certified.

| Category | Score | Evidence |
| --- | ---: | --- |
| Error handling | 9 | Event/artifact/outbox conflicts roll back; leases must be current; retryable, permanent and deadline errors have distinct paths; Redis health fails closed. |
| Logging/trace safety | 8 | Queue facts expose IDs, profile, logical queue, attempt and safe error code only; no payload, stack, credential or chain-of-thought enters traces. |
| Type safety | 9 | Strict job/entity/outbox/projection types, fixed vector dimensions, bounded enums, JSON validation and package/app typechecks pass. |
| Testability | 9 | Unit suites plus real Neon and isolated Redis integration tests; randomized workspaces/namespaces clean up their own state. |
| Performance | 9 | Composite claim indexes, `SKIP LOCKED`, bounded batches, one physical queue per profile, dependency-aware idempotent stage execution, cross-replica Redis admission slots, no Redis `KEYS` call, plus GIN/HNSW/Typesense paths. |
| Security | 9 | Forced RLS covers entities, outbox, connectors, artifacts, embeddings, enrichments and search receipts; dedicated `NOBYPASSRLS` roles, transaction-local scope, version-bound writes, atomic webhook replay claims, raw-body hash-only retention, credential-key rejection and compact hashed DLQ. |
| AI verification | 9 | Live tests exposed and corrected two non-obvious defects: Neon owner RLS bypass and microsecond cursor replay. Configured Upstash failure is retained as a blocker. |

## Verification evidence

- `bun run check` — pass.
- Knowledge/queue/app typechecks — pass.
- `bun test packages/certification packages/connectors packages/knowledge packages/queues`
  — 43 pass and 13 opt-in live cases skipped by default.
- Live Neon: 5 pass, including atomic rollback, two-tenant RLS, stable cursors,
  lease/publish/dead-letter behavior and forbidden payload rejection.
- Live isolated Redis 8.6/BullMQ: 1 mixed-workload suite pass with 17 assertions,
  two runtime replicas, noisy/quiet tenants, transient/permanent/deadline paths,
  sanitized DLQ and trace facts.
- Live Neon → isolated Redis/BullMQ: 1 cross-plane suite pass; a forced crash
  after enqueue but before outbox acknowledgement is reclaimed and processed
  exactly once.
- Live Neon connector store: 1 suite pass with 9 assertions, including
  concurrent signed-webhook replay rejection, RLS, immutable artifact replay,
  authority mismatch rejection and four atomic outbox events.
- Live Neon → isolated Redis/BullMQ connected pipeline: 1 suite pass with 4
  assertions; canonical-write, enrichment, embedding and projection all ran,
  preserved tenant/trace/artifact lineage and left no pending replay.
- Live Neon lexical retrieval: bounded five-query corpus reached recall@3 1.0,
  cross-tenant matches stayed invisible, and `EXPLAIN` selected the generated
  `tsvector` GIN index. Stable explicit select lists survived the additive
  column migration without changing repository result types.
- Live Neon + AI Gateway semantic retrieval: real 1536-dimension embeddings,
  HNSW cosine plan, cross-tenant isolation, version-stale rejection and combined
  recall at or above the 0.8 release threshold.
- Live Neon → outbox → isolated Redis/BullMQ → AI Gateway → Neon: concrete
  embedding processor projected one canonical entity and returned it through a
  semantic query; 1 pass with 5 assertions.
- Live Neon versioned projections: 7 repository tests and 41 assertions pass,
  including enrichment/search receipt replay, stale-version rejection and
  cross-tenant RLS invisibility.
- Live Neon → isolated Redis/BullMQ concrete processor chain: canonical entity,
  enrichment, embedding and alternate-index receipt all landed. A simulated
  crash after external upsert recovered with exactly one external document and
  one receipt.
- Official local Typesense 30.2: real HTTP upsert replay and tenant-filtered
  retrieval passed with one result and no API key in the provider result.
- Payload-free queue telemetry: 3 tests and 6 assertions cover bounded state,
  p95 queue/processing latency, retry/DLQ/throttle/in-flight counters, alert
  thresholds, and omission of workspace, trace and error details from snapshots.
- Live Neon ContextPackets: migration 0050 plus 8 repository tests and 46
  assertions prove immutable hash-verified replay, forced-RLS isolation and
  cross-tenant invisibility. Pure tests cover deterministic diffs and rejection
  of tampering, duplicate evidence, unbounded queries and invalid revisions.
- Operating-pack evidence boundary: broker tests prove `knowledge_read` accepts
  only a hash-valid ContextPacket bound to the current workspace/execution. Eve
  tool facts retain the accepted packet hash, never the evidence snippets.
- Cross-repository broker contract: Desk PR #541 emits/persists schema-v2 packets
  bound to workspace, workflow, specialist agent and trace. The Desk-produced
  value was accepted by Open Agents' actual `validateContextPacket`; changing the
  specialist changes the packet hash. Ten focused Desk tests pass and
  `@bu/intelligence` typechecks. The Desk full API shard still exposes unrelated
  pre-existing type debt, so this is not represented as a green Desk build.
- Tenant-safe citation resolution: Desk PR #541 verifies membership before any
  packet read and rechecks schema, packet hash, citation/reference alignment and
  storage/workspace binding. Unknown handles return 404; tampered packets return
  409. Seven focused adapter/resolver tests pass.
- Configured Upstash: TCP opens but TLS/Redis readiness times out; **not green**.

## Follow-ups required for production claim

1. Provision a reachable BullMQ-compatible hosted Redis deployment and repeat
   the live suite under provider latency and connection limits.
2. Deploy the outbox relay and concrete workers, then execute DB/Redis kill and
   redrive chaos against the hosted Typesense/provider constraints.
3. Wire the queue telemetry sink into the deployed workers and BUFI trace
   cockpit; add lag/age/CPU/memory/DB/provider metrics and alert delivery.
4. Repeat Typesense certification against the hosted provider, then run a larger
   retrieval recall/latency corpus and scheduled freshness repair under load.
5. Run authorized Pipedream, Magic Inbox and accounting/ERP sandbox events
   through the same signed-event/artifact path.

## Gateman verification — migration 0049 and concrete processors

### Four-law audit

1. **Assume Nothing — pass.** Queue routes, artifact/revision/connection
   references, entity versions, confidence ranges, SHA-256 references,
   timestamps, Typesense URLs, API-key presence and provider response IDs are
   validated at runtime. The audit found and fixed a missing
   artifact-to-connection authority comparison.
2. **Question Everything — pass with follow-ups.** The prior “four-stage pass”
   was challenged and shown to execute no-op handlers. The replacement is
   observed writing canonical, enrichment, embedding and search state in live
   Neon, retrying through real BullMQ, and retrieving from real Typesense.
   Hosted-provider latency and kill/restart evidence remain deliberately open.
3. **Worship No One — pass.** Typesense 30.2 was verified against the official
   image and HTTP response rather than its TypeScript type. Postgres RLS was
   queried from the no-bypass runtime role. Existing `SELECT *`/`RETURNING *`
   outbox reads were removed after the audit identified rolling-migration risk.
4. **Applaud Humility — pass.** The result remains `YES_WITH_FOLLOWUPS`; local
   Typesense and isolated Redis are not represented as hosted production
   certification, and 66.8% is not represented as full parity.

### Section results

- **Input validation:** pass; bounded identifiers, exact hashes, finite numbers,
  strict routes and safe HTTPS/localhost provider URLs.
- **External identifiers:** pass; connector/provider IDs remain scoped
  attributes, while internal entity IDs own foreign keys.
- **Side-channel/fraud surface:** N/A for value movement; the relevant replay,
  cross-tenant and cross-connector authority surfaces are explicitly denied.
- **Configuration:** pass with follow-up; provider URL/key/collection are injected,
  while classifier/search schema versions are named constants. Deployed secrets
  and hosted targets are still unconfigured.
- **Money/time/reversibility:** no money path; timestamps are ISO/UTC and all
  projections are rebuildable from canonical source artifacts.
- **Failure modes:** pass; bounded BullMQ retry/backoff/DLQ, version checks,
  idempotent provider document IDs and a crash-after-effect repair test.
- **Observability:** pass with follow-up; safe queue facts feed bounded,
  payload-free p95 latency/retry/DLQ/throttle/in-flight metrics and structured
  SLO alerts, but deployed export, provider-duration metrics and alert delivery
  remain absent.
- **AI verification:** pass; imports and APIs were grepped, all changed files were
  re-read, 165 isolated test files passed, migration 0049 ran on Neon, and the
  official Typesense version/flags were checked against current documentation.
  The new tests were not retroactively run on an unmodified worktree; instead,
  the old implementation was directly inspected and shown to contain only the
  embedding effect while its live certification handler merely collected jobs.

### Score

| Category | Score | Note |
| --- | ---: | --- |
| Error handling | 9 | Validation, provider, stale-write, retryable and permanent failures are distinguishable. |
| Logging | 8 | Correlated payload-free queue facts exist; deployed duration/lag metrics remain open. |
| Type safety | 9 | No `any` or ignored compiler errors; foreign JSON has narrow runtime checks. |
| Testability | 9 | Pure providers/processors are injected and unit/live paths cover replay and failure. |
| Performance | 9 | Indexed receipts, bounded queries and profile multiplexing; hosted load remains open. |
| Security | 9 | Forced RLS, scoped roles, authority binding, HTTPS and secret-safe results. |
| AI verification | 9 | Claims were verified against code, live services, current docs and full CI. |

Highest-leverage improvement bucket: **P3 — Deployed observability**, followed
by deployed P4 chaos. Connect the new queue metric/SLO contract to the worker
deployment and cockpit, then add provider duration, lag, redrive and saturation
signals before raising this slice to a production claim.

**Risk:** MEDIUM

**Safe to ship:** YES_WITH_FOLLOWUPS
