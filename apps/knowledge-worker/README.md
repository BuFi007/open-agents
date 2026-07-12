# BUFI knowledge relay and worker

This is the long-running process boundary for the non-tax Agentic Workspaces
data plane. It is intentionally separate from the Next.js application.

Deploy the same image as separate services:

- `KNOWLEDGE_WORKER_MODE=relay`: claims committed Postgres outbox rows for the
  explicit workspace allowlist and publishes them to BullMQ.
- `KNOWLEDGE_WORKER_MODE=source`: consumes canonical-write work.
- `KNOWLEDGE_WORKER_MODE=knowledge`: consumes enrichment, embedding, Typesense
  projection and repair work.
- `KNOWLEDGE_WORKER_MODE=all`: guarded dogfood topology only; it combines the
  three roles in one process.

`/livez` is process liveness. `/readyz` fails closed when Redis/workers are not
ready, the relay has not completed a recent cycle, or its latest cycle failed.
Railway uses `/readyz` as the rollout gate.

Queue facts are grouped by workspace and originating run, bounded in memory,
converted to payload-free integrity-bound snapshots, and delivered to Open
Agents. A failed telemetry delivery is retained for bounded retry without
changing job semantics. The optional alert webhook receives only structured SLO
alerts, never job payloads or provider error details.

Relay deployments currently require an explicit `KNOWLEDGE_WORKSPACE_IDS`
allowlist. This is deliberate: a shared worker must not enumerate tenant IDs
through a broad database credential. Add workspaces through deployment config
until a reviewed tenant-safe scheduler/control-plane feed is shipped.
