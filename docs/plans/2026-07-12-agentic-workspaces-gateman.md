# Gateman audit — non-tax Agentic Workspaces closure slice

## Decision

**Ship the code slice; do not claim 100% production parity.**

The implementation is safe to merge behind the existing deployment and
workspace gates. Production certification remains conditional on the external
provider, device, hosted-route, and resource evidence listed at the end.

## Checklist

| Gate | Result | Evidence |
| --- | --- | --- |
| Input validation | PASS | Repair interval, age, batch, workspace IDs, provider IDs, artifact hashes, MIME, and timestamps are bounded and fail closed. |
| External identifiers | PASS | Repair jobs use workspace, artifact, connector, source revision, entity, provider, collection, and stable digest IDs. |
| Money and time | PASS | No new money movement is introduced; Circle spend remains an approval-granted broker call. Repair freshness uses explicit epoch milliseconds and bounded intervals. |
| Failure modes | PASS | Repair errors fail readiness; stable enqueue replay is observable; agent harness failures persist `agent.failed` before rethrowing. |
| Configuration | PASS | Worker repair cadence and batch size are explicit environment settings; no credentials or provider defaults are inferred. |
| Observability | PASS WITH FOLLOW-UP | `/readyz` exposes repair running/age/error/scheduled/replayed counters, traces include agent start/failure/completion, and the authenticated production catalog is live. Hosted provider saturation and full external harness traces are still open. |
| Security | PASS | Workspace/run HMAC broker binding, compiled tool grants, approval metadata, metadata-only artifact envelopes, and secret redaction remain intact. |
| Testability | PASS LOCALLY | 151 non-tax package tests pass, focused scheduler/provider/broker tests pass, and monorepo typecheck passes. 20 live tests remain opt-in. |
| AI behavior | CONDITIONAL | Open Agents target-specific matrix passes, and the production `agent_wallet` catalog exposes 17 grant-bound tools. Hermes/Codex handshakes pass. Claude is credit-blocked; Computer Use is TCC-blocked. |

## Required production follow-ups

- Run authorized Pipedream, Magic Inbox, QuickBooks, Xero, Conta Azul, and
  Contabilium sandbox events through the deployed connector and scheduler.
- Run Redis/Postgres/Typesense saturation, noisy-neighbor, and kill/restart
  tests with resource metrics and a larger retrieval corpus.
- Deploy the current command-center route and run authenticated browser and
  Expo/Cleo device journeys, including approval, cancellation, traces, and
  citations.
- Re-run Claude and Computer Use after credits and macOS TCC permissions are
  available.
- Produce one internal operating-week report with three workflows, five KPIs,
  linked traces, and zero unexpected spend.

Until those are attached to the evidence ledger, the correct status is
**production-ready code slice with open certification gates**, not 100% parity.
