# Gateman — Postgres KG + connector + BullMQ production slice

Date: 2026-07-11  
Scope: non-tax BU-218/219/220/221/222/223 production infrastructure slice.

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
| Performance | 9 | Composite claim indexes, `SKIP LOCKED`, bounded batches, one physical queue per profile, cross-replica Redis admission slots, no Redis `KEYS` call, plus a generated lexical vector and GIN planner assertion. |
| Security | 9 | Forced RLS covers entities, outbox, connectors, artifacts and embeddings; dedicated `NOBYPASSRLS` roles, transaction-local scope, version-bound vector writes, atomic webhook replay claims, raw-body hash-only retention, credential-key rejection and compact hashed DLQ. |
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
- Configured Upstash: TCP opens but TLS/Redis readiness times out; **not green**.

## Follow-ups required for production claim

1. Provision a reachable BullMQ-compatible hosted Redis deployment and repeat
   the live suite under provider latency and connection limits.
2. Deploy the outbox relay and concrete workers, then execute DB/Redis kill and
   redrive chaos against real side-effect idempotency constraints.
3. Add lag/age/CPU/memory/DB/provider metrics and alert thresholds to the
   deployed workers.
4. Certify the alternate Typesense projection, larger retrieval recall/latency
   corpus and freshness repair under load.
5. Run authorized Pipedream, Magic Inbox and accounting/ERP sandbox events
   through the same signed-event/artifact path.
