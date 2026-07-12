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

## Decision

The worker freshness and telemetry slices are now live-certified. Do not count
the low-volume resource sample as the missing saturation proof, and do not
claim 100% parity until the remaining provider, authenticated Desk/Expo, and
capacity-envelope evidence is attached.
