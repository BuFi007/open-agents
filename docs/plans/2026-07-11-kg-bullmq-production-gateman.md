# Gateman — Postgres KG + BullMQ production slice

Date: 2026-07-11  
Scope: non-tax BU-219/220/221 production infrastructure slice.

## Verdict

**YES_WITH_FOLLOWUPS — MEDIUM risk.** The implementation is safe to review and
deploy behind migration/readiness gates. It is not a claim that the configured
hosted Redis provider or the complete connected-data pipeline is production
certified.

| Category | Score | Evidence |
| --- | ---: | --- |
| Error handling | 8 | Idempotency conflicts roll back; leases must be current; retryable, permanent and deadline errors have distinct paths; Redis health fails closed. |
| Logging/trace safety | 8 | Queue facts expose IDs, profile, logical queue, attempt and safe error code only; no payload, stack, credential or chain-of-thought enters traces. |
| Type safety | 9 | Strict job/entity/outbox types, bounded enums, JSON validation and package/app typechecks pass. |
| Testability | 9 | Unit suites plus real Neon and isolated Redis integration tests; randomized workspaces/namespaces clean up their own state. |
| Performance | 8 | Composite claim indexes, `SKIP LOCKED`, bounded batches, one physical queue per profile, cross-replica Redis admission slots and no Redis `KEYS` call. |
| Security | 9 | Forced RLS, dedicated `NOBYPASSRLS` runtime role, transaction-local tenant scope, credential-key rejection, 64 KiB payload ceiling and compact hashed DLQ. |
| AI verification | 9 | Live tests exposed and corrected two non-obvious defects: Neon owner RLS bypass and microsecond cursor replay. Configured Upstash failure is retained as a blocker. |

## Verification evidence

- `bun run check` — pass.
- Knowledge/queue/app typechecks — pass.
- `bun test packages/knowledge packages/queues` — 26 pass, live suites skipped by default.
- Live Neon: 5 pass, including atomic rollback, two-tenant RLS, stable cursors,
  lease/publish/dead-letter behavior and forbidden payload rejection.
- Live isolated Redis 8.6/BullMQ: 1 mixed-workload suite pass with 17 assertions,
  two runtime replicas, noisy/quiet tenants, transient/permanent/deadline paths,
  sanitized DLQ and trace facts.
- Live Neon → isolated Redis/BullMQ: 1 cross-plane suite pass; a forced crash
  after enqueue but before outbox acknowledgement is reclaimed and processed
  exactly once.
- Configured Upstash: TCP opens but TLS/Redis readiness times out; **not green**.

## Follow-ups required for production claim

1. Provision a reachable BullMQ-compatible hosted Redis deployment and repeat
   the live suite under provider latency and connection limits.
2. Deploy the outbox relay and concrete workers, then execute DB/Redis kill and
   redrive chaos against real side-effect idempotency constraints.
3. Add lag/age/CPU/memory/DB/provider metrics and alert thresholds to the
   deployed workers.
4. Certify Typesense/embedding projection and retrieval recall under load.
