# Agentic Workspaces final Gateman audit

Date: 2026-07-11
Scope: Agentic Workspaces contract parity and end-to-end certification across Open Agents plus referenced Desk/Circle work.
Excluded by user instruction: Tax Agent implementation.

## 1. Objective and scope

The goal was to reach 100% bucket-analysis parity for Agentic Workspaces and prove the result with an end-to-end test. The pass implemented or reconciled the contract layer for:

- agent wallet face/provisioning;
- Circle agent-wallet tools and public kit scaffold;
- filesystem agent roster and capability bundles;
- durable workflow DAG, retries, cancellation, budgets and approval contract;
- native trace model;
- WorkspaceHarness and scoped MCP invocation contract;
- tenant-safe knowledge, outbox, BullMQ profiles, retrieval/freshness/production gates;
- connector manifests, SourceArtifacts and exactly-once ERP effects;
- Context Packets, Knowledge Steward and workspace ontology;
- Desk and Expo command-center contracts;
- cross-package certification replay.

## 2. Evidence reviewed

- Bucket report: `docs/plans/2026-07-11-agentic-workspaces-bucket-analysis.md`.
- Certification E2E: `packages/certification/agentic-workspaces.e2e.test.ts`.
- Workflow type fix: `packages/workflow/kernel.ts`.
- Per-slice Gateman notes under `docs/plans/*-gateman.md`.
- Circle kit reference: `/Users/criptopoeta/coding-dojo/BUFI/.codex-references/agent-stack-starter-kits/kits/bufi-on-shrooms/GATEMAN.md`.
- Circle parity package: public `@bufinance/intelligence@0.4.0`, merged
  `BuFi007/intelligence#1` and merged `BuFi007/bu-intelligence-agent#2`.
- Desk command center and Team Cockpit: `BuFi007/desk-v1#542`.
- Expo/Cleo workflow inbox: `BuFi007/desk-v1#544`.

## 3. Test and verification results

Passed:

- `bun test packages/certification`
- `bun run --cwd packages/certification typecheck`
- `bun run --cwd packages/workflow typecheck && bun test packages/workflow packages/certification`
- `bun run test:isolated`
- `bun run typecheck`
- Full repository CI: 178 isolated test files, 18 package typechecks, 125
  generated workflow steps across five workflows and twelve classes, with
  migrations in sync.
- Fresh live Neon connector/RLS/lexical/pgvector/AI Gateway suite: ten tests.
- Fresh harness certification for Hermes, Codex, Open Agents, bufi-hyper Circle
  discovery and the existing Circle wallet read-only path.

Previously passed in referenced slices:

- connector, SourceArtifact and ERP effect package tests/typechecks;
- knowledge ContextPacket, steward and ontology tests/typechecks;
- harness, command-center, pack composer, Team Cockpit, mobile inbox, strict
  deep-link, notification and queue profile tests/typechecks;
- Circle `bufi-on-shrooms` kit install/typecheck/build;
- Desk BU-207 focused and package-level tests/typecheck/build;
- Desk BU-209 focused tests and package typecheck, with unrelated Shiva worktree type errors recorded separately.

## 4. Security and privacy review

Pass with follow-ups.

- Signed connector events require timestamp, deployment, environment and replay checks.
- SourceArtifact stores deterministic metadata and content hashes rather than raw provider payloads.
- ContextPacket references are bounded, redacted and hashable.
- Knowledge steward prevents unsafe null overwrites and routes destructive changes through review.
- Worker profile metadata is sanitized for DLQ/debug paths.
- Trace data is redacted and excludes chain-of-thought/raw financial payloads by contract.
- Fantasmita/tax-agent work remains out of this pass.

Follow-up: run authorized Pipedream, Magic Inbox and accounting-provider
sandboxes before production launch. Railway Redis now passes the deployed
relay/source path; broader hosted provider-load and chaos certification remains.

## 5. Reliability and performance review

Pass with follow-ups.

- Workflow contract supports dependency validation, fan-out/join topology, retries, cancellation, budgets and approval nodes.
- Queue plan and BullMQ profile contracts encode concurrency, workspace fairness, retry classes and sanitized DLQ metadata.
- Production gate contract records migration replay, tenant isolation, restart loss, p95 latency, recall and chaos criteria.

The original Upstash endpoint still closes TLS before handshake, but it is no
longer the active worker target. Separate Railway relay and canonical-source
services now pass health checks and process a real Neon outbox artifact through
Railway Redis. The mixed noisy/protected workload and crash-after-enqueue replay
pass against Railway Redis. A literal Redis redeploy also completed; all three
worker modes recovered readiness and a fresh four-stage fixture passed afterward.
The live three-boundary gate then killed workers before the Postgres effect and
after the effect but before BullMQ acknowledgement; both recovered with one
stable version-1 entity and no committed-job loss. Resource saturation remains
open.

Follow-up: execute schema-validated DLQ redrive and provider-resource saturation
against Railway. The
authenticated payload-free ingress, ordered trace persistence and queue cockpit
now pass locally and against live Neon.
Protected hosted delivery is also certified through Vercel deployment
`dpl_Gg7YQdjYVhy2V9jwGAHfZ2UtH5dX`: first acceptance persisted sequence 2,
exact replay returned the same sequence, and one payload-free SLO trace remained
in Neon. The reusable `queue:certify:hosted` command creates and cleans its own
fixture. Delivery from the deployed relay/source topology now also passes.

The process boundary is implemented as a standalone Railway-ready
image with isolated relay, canonical-source and knowledge-AI modes, fail-closed
readiness, bounded workspace/run telemetry, optional payload-free SLO webhook
delivery and graceful shutdown. The image builds. A real `all`-mode process
reported both worker profiles ready and a fresh relay cycle against live Neon
plus isolated Redis, then exited cleanly on SIGINT. Railway deployments
`c3d2bd2c-2cc4-4e29-990b-1807ea0192b7` (relay) and
`045d547f-a09e-405d-8d8f-259af1cc2d2b` (source) now pass `/readyz`. A disposable
certification fixture proved Neon artifact/outbox → Railway Redis → source worker
→ canonical KG entity → protected Vercel telemetry, with queued and completed
facts and zero fixture rows after cleanup. Railway deployment
`08e50274-f9ba-440f-97dc-e24a86537898` also passes `/readyz` in knowledge-AI mode.
The upgraded fixture proved enrichment, a real 1,536-dimension AI Gateway
embedding and a matching hosted Typesense 30.2 projection/receipt, then removed
all Postgres and external-index fixture state. A later live repair event restored
a deliberately deleted Typesense document with the same input hash. A deployed
worker also delivered a real DLQ SLO violation through the protected webhook
into one payload-free `queue.alert` trace. DLQ redrive and saturation/load remain
follow-ups.

## 6. Product and UX contract review

Pass with follow-ups.

- Desk command center, pack composer, Team Cockpit and Expo inbox consume the
  same workflow/harness/trace/approval/entity model.
- The Open Agents command center now renders validated queue p95, retry,
  dead-letter and SLO-alert snapshots without job payloads.
- The public Circle kit includes a BUFI-branded terminal theme.
- Client policy duplication is avoided at the contract boundary.
- Desk's internal broker enforces the grant scope required by each exposed tool,
  and its mobile citation route independently requires `knowledge.read` before
  opening an admin client. Open Agents packet hashes are adapted to Desk's
  64-hex storage constraint and revalidated on retrieval. Nineteen focused tests,
  intelligence typecheck, and forced deployment
  `dpl_8xhfT9gB74pmLNcJjMaxzxhCRFHP` pass.

Follow-up: exercise the already-implemented surfaces through an authenticated
signed Desk browser journey and a physical Expo device journey. A forced Desk
preview build is `READY`, its unauthenticated login and invalid-scope boundaries
pass, focused tests and Expo web export pass; those are not authenticated or
physical-device E2E.

## 7. Known blockers outside this certification

These are not hidden failures; they are external/live-certification requirements:

- Explicit operator approval for any live Circle wallet provisioning or spend.
- Writable public fork/upstream PR path for the remaining Circle starter-kit
  contribution.
- Claude Code login/credits; its live handshake reports not authenticated.
- macOS Accessibility and Screen Recording grants for CuaDriver. The binary and
  MCP session are healthy, but TCC capabilities are denied.
- Supabase load, hosted queue/Typesense chaos, Pipedream, Gmail/Outlook and accounting-provider sandbox matrices.
- Authenticated Desk and physical-device Expo E2E.

## 8. Decision

Decision: **YES_WITH_FOLLOWUPS for review; NO for 100% production parity.**

The strict bucket score is **82.7%**. Architecture, core runtime, Desk and Expo
implementation are coherent, and the strongest live paths pass. Production/live
provider parity is not certified while hosted load/chaos, provider sandboxes,
authenticated client journeys, Claude Code and Computer Use remain red.

Risk rating: **Medium-high for general availability**; **medium for guarded
review/preview deployment**. Do not close the umbrella goal or the affected
Linear gates until the external and authenticated acceptance evidence exists.
