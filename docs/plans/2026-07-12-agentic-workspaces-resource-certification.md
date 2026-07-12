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
