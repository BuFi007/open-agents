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
- Full repository CI: 176 isolated test files, 17 package typechecks, 125
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
sandboxes before production launch. The configured hosted Redis provider must
also be replaced or repaired before the connector data plane can be certified.

## 5. Reliability and performance review

Pass with follow-ups.

- Workflow contract supports dependency validation, fan-out/join topology, retries, cancellation, budgets and approval nodes.
- Queue plan and BullMQ profile contracts encode concurrency, workspace fairness, retry classes and sanitized DLQ metadata.
- Production gate contract records migration replay, tenant isolation, restart loss, p95 latency, recall and chaos criteria.

Fresh production-target evidence is red, not absent: the configured Upstash
endpoint closes TLS before handshake, and eight BullMQ/outbox/worker cases fail.
Local isolated Redis kill/restart evidence remains green but is not a substitute.

Follow-up: repair the hosted Redis target, then execute the mixed workload,
kill/restart/redrive and provider-load tests against that target and export queue
SLOs from the deployed workers. The authenticated payload-free ingress, ordered
trace persistence and queue cockpit now pass locally and against live Neon.
Protected hosted delivery is also certified through Vercel deployment
`dpl_Gg7YQdjYVhy2V9jwGAHfZ2UtH5dX`: first acceptance persisted sequence 2,
exact replay returned the same sequence, and one payload-free SLO trace remained
in Neon. The reusable `queue:certify:hosted` command creates and cleans its own
fixture. Delivery from the actual deployed relay/worker topology remains open.

## 6. Product and UX contract review

Pass with follow-ups.

- Desk command center, pack composer, Team Cockpit and Expo inbox consume the
  same workflow/harness/trace/approval/entity model.
- The Open Agents command center now renders validated queue p95, retry,
  dead-letter and SLO-alert snapshots without job payloads.
- The public Circle kit includes a BUFI-branded terminal theme.
- Client policy duplication is avoided at the contract boundary.

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
- Supabase, Redis, Typesense, Pipedream, Gmail/Outlook and accounting-provider sandbox matrices.
- Authenticated Desk and physical-device Expo E2E.

## 8. Decision

Decision: **YES_WITH_FOLLOWUPS for review; NO for 100% production parity.**

The strict bucket score is **80.1%**. Architecture, core runtime, Desk and Expo
implementation are coherent, and the strongest live paths pass. Production/live
provider parity is not certified while hosted Redis, provider sandboxes,
authenticated client journeys, Claude Code and Computer Use remain red.

Risk rating: **Medium-high for general availability**; **medium for guarded
review/preview deployment**. Do not close the umbrella goal or the affected
Linear gates until the external and authenticated acceptance evidence exists.
