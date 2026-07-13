# Agentic Workspaces hosted worker/resource certification — 2026-07-12

This is non-tax evidence for the deployed Railway worker plane. It does not
claim that a low-volume fixture is equivalent to a capacity-limit saturation
test.

## Functional workload

- Four concurrent copies of `scripts/certify-hosted-worker-plane.ts` ran
  against the production `agentic-knowledge-source`/`agentic-knowledge-ai` /
  Redis / Typesense path.
- All four completed the canonical-write, enrichment, 1,536-dimension
  embedding, Typesense projection, and idempotent repair checks.
- Every copy observed `queued=4`, `completed=4`, and cleaned its fixtures.
- A subsequent single run completed after enabling the production repair
  scheduler on `agentic-knowledge-ai`.

## Resource observation

Railway `metrics --all --json --since 5m` sampled five times while the four
fixtures ran:

| Measure | Maximum observed |
| --- | ---: |
| Service CPU utilization | 0.3% |
| Service memory utilization | 0.6% |

The values are well below the service envelope and therefore prove bounded
behavior for this fixture, not saturation. The proper high-concurrency,
noisy-neighbor, provider-latency, and database-connection ceiling matrix
remains an open production gate.

## Repair and telemetry wiring

- `agentic-knowledge-ai` now has an explicit workspace allowlist and bounded
  repair configuration (`300000ms` interval, `86400000ms` max age, batch `500`).
  The deployed worker logs `configuredWorkspaces=1` after redeploy.
- All three Railway worker modes now target the production Open Agents
  `/api/internal/queue-telemetry` route.
- The shared telemetry secret is configured on the production Vercel project.
- Hosted telemetry certification passed: first delivery `accepted=true,
  replayed=false`, exact replay `replayed=true` at the same sequence, with a
  persisted payload-free `queue.telemetry` trace containing three SLO alerts.

## Higher-concurrency rerun

- Eight concurrent copies of the same certifier ran through the production
  knowledge-AI service with the Typesense administrative cleanup credential
  supplied out-of-band. All eight completed the four-stage pipeline and repair
  check (`queued=4`, `completed=4`) and removed their fixtures.
- During the run, the maximum observed AI-worker CPU utilization was 1.4% and
  maximum memory utilization was 0.4%. A post-run database check found zero
  source artifacts, entities, enrichments, embeddings, projections, outbox rows,
  or connector deployments remaining in the certification workspace.
- This is stronger bounded-envelope evidence than the original four-fixture
  sample, but it is still not a saturation, noisy-neighbor, or kill-at-every-
  boundary proof.

## Decision

The worker freshness and telemetry slices are now live-certified. Do not count
the low-volume resource sample as the missing saturation proof, and do not
claim 100% parity until the remaining provider, authenticated Desk/Expo, and
capacity-envelope evidence is attached.

## Current redeploy rerun

After synchronizing the worker/Typesense API key, eight concurrent copies of
the certifier completed with exit code 0. Railway's five-minute
`agentic-knowledge-ai` window reported a maximum of 1.1% CPU utilization and
0.4% memory utilization; the post-run database check found zero certification
deployments, artifacts, runs, and outbox rows. This refreshes the bounded
envelope evidence on deployment `4a879e44-e692-4291-be6b-1c85dddf543e`, but it
still does not claim saturation or noisy-neighbor capacity.

## Sixteen-concurrent provider rerun

On 2026-07-12, sixteen concurrent copies of the certifier ran against the
same deployed worker plane. All sixteen exited zero; each completed the four
published stages, payload-free telemetry, and idempotent repair replay, and
each removed its temporary database and Typesense state. Railway's
`agentic-knowledge-ai` metrics over the 20-minute window reported:

| Measure | Maximum observed | Service limit |
| --- | ---: | ---: |
| CPU units | 0.5197 | 24 |
| Memory | 113.6 MB | 24,576 MB |

This is the strongest current bounded-envelope sample, but the values remain
far below the service ceiling. It does not substitute for a deliberate
saturation/noisy-neighbor/connection-limit test.

## Controlled 32-concurrent flood

A follow-up flood launched 32 certifiers against one workspace. Twenty-four
completed all stages and cleaned up; eight timed out at the certifier's
120-second initial-stage deadline. Railway maxima remained low (1.3% CPU
utilization and 132.98 MB memory). This is not a pass: it demonstrates that the
workspace fair-share/backpressure boundary is active under a burst, while the
remaining deadline failures require a deliberate capacity decision and must
not be hidden behind a longer test timeout. No fixture state remained after the
run.

## Deadline-bounded 32-concurrent rerun — 2026-07-12

The certifier now accepts bounded `KNOWLEDGE_WORKER_CERT_INITIAL_TIMEOUT_MS`
and `KNOWLEDGE_WORKER_CERT_REPAIR_TIMEOUT_MS` values (10 seconds to 15
minutes). With both deadlines set to five minutes, 32 concurrent production
certifiers completed all canonical-write, enrichment, embedding, Typesense
projection, telemetry, repair-replay, and cleanup assertions. Result: **32
completed, 0 failed, 0 missing, 0 non-certified logs**.

Railway metrics sampled the worker during the flood:

| Measure | Maximum observed | Service limit |
| --- | ---: | ---: |
| CPU units | 0.5583 | 24 |
| Memory | 0.1285 GB | 24 GB |

This closes the previous deadline failure and provides a deliberate
high-concurrency bounded-envelope result. It is still not a claim that the
worker was driven to its absolute CPU, memory, database-connection, or external
provider ceiling; those ceiling tests remain a separate follow-up.

## Multi-workspace attempt — not counted

An exploratory 8-noisy/4-protected workspace run was intentionally not counted
as capacity evidence: all 12 fixtures missed the initial convergence deadline
because the deployed worker's explicit production workspace allowlist contains
only the certification workspace. This validates that the allowlist is active,
not that the provider or database saturated. The certifier's cleanup path ran,
and no result from this attempt is used in the parity score.

## Bounded 64-concurrent ceiling probe — 2026-07-12

Using the live Railway Redis/Postgres/Typesense worker plane and the isolated
certification workspace, 64 concurrent certifiers were launched with five-
minute initial and repair deadlines. **60 completed and 4 failed**. The run is
not a pass: the four failures are a real deadline/backpressure signal that
needs error classification and an explicit capacity policy. Railway metrics for
the one-hour window containing the flood were:

| Measure | Maximum observed | Service limit |
| --- | ---: | ---: |
| CPU | 0.5958 vCPU | 24 vCPU |
| Memory | 145.9 MB | 24,576 MB |

The low resource maxima show that this run did not saturate CPU or memory. It
strengthens the bounded-envelope evidence and narrows the remaining capacity
work to provider latency, database/connection ceilings, admission fairness, and
classification of the four failed certifiers. No customer workspace, wallet,
or payment state was touched.

## Telemetry retry redeploy rerun — 2026-07-12

The telemetry HTTP sink now retries transient `408`, `425`, `429`, and `5xx`
responses with a bounded three-attempt exponential budget; the focused queue
suite passes 9 tests and 30 assertions. A clean worker deployment
`fa1b30e3-9d61-4e42-a05d-8b7a0c7e9096` was promoted to the production
`agentic-knowledge-ai` service and the 64-concurrent probe was repeated.
Result: **61 completed, 3 failed**. This is a one-run improvement, not a pass:
the remaining failures still coincide with telemetry delivery pressure and
require a durable ingress/backpressure decision before the capacity gate can
close.

The Open Agents ingress was then redeployed with sanitized persistence-failure
classification at `dpl_9vYHG2uSY75a8fHu4YJPtWJSfeHr`. A post-deploy 16-concurrent
probe completed **16/16** with no telemetry failures. The lower-load pass
confirms the remaining failures are isolated to the higher-concurrency
ceiling, not a baseline configuration or authentication defect.

## Queue-telemetry export ledger fix and ceiling rerun — 2026-07-12

The ingress diagnostic identified the remaining persistence defect precisely:
background repair telemetry uses `trace-repair-*` identifiers that are not
operating-pack run IDs. Open Agents commit `ef196076` adds the migration
`0053_queue_telemetry_exports` and a redacted, workspace/run-bound export ledger.
Queue telemetry now replays idempotently outside the operating-pack trace table,
while ordinary traces still require a real workspace-owned run. Route tests
(3 tests / 10 assertions), Biome, the web TypeScript check, and a clean Vercel
production build all passed; the migration applied during deployment
`dpl_Brp3mzphTaS9R6y2rahr4f8JSzWg`.

The controlled hosted worker certifier then completed all four stages, payload-
free telemetry, repair replay, and cleanup with **1/1** success. A fresh
five-minute 64-concurrent flood completed **62/64** (two initial convergence
deadlines). This is an improvement over the prior 61/64 result and materially
narrows the remaining issue to high-concurrency ingress/provider backpressure;
it is not a capacity pass. Railway worker logs showed no new ingress persistence
classification after the ledger deployment, while the bounded probe still
recorded telemetry delivery pressure at the ceiling. CPU/memory saturation was
not demonstrated, so the capacity gate remains open pending connection,
provider-latency, and admission-fairness evidence.

## Bounded telemetry concurrency experiment — 2026-07-12

The reporter now supports a bounded concurrent export budget (1–32) with a
regression test; this is an opt-in optimization and retains the same replay,
retry, and payload-free semantics. A worker deployment with budget 8 passed the
32-way envelope (**32/32**) but produced mixed 64-way results (**59/64** and
**60/64**), so concurrency is not counted as a capacity fix. Production now
defaults back to a conservative single sender (`d2c929de`) while preserving the
bounded option for a separately admitted, measured rollout. The post-rollback
single-certifier run passed all canonical, AI, projection, telemetry, repair,
and cleanup assertions.
