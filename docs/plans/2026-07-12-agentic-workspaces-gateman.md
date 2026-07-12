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
| Observability | PASS WITH FOLLOW-UP | `/readyz` exposes repair running/age/error/scheduled/replayed counters; the production repair allowlist is enabled; telemetry delivery/replay now persists a payload-free trace with three SLO alerts; traces include agent start/failure/completion; and the authenticated production catalog is live. Hosted provider saturation and full external harness traces are still open. |
| Security | PASS | Workspace/run HMAC broker binding, compiled tool grants, approval metadata, metadata-only artifact envelopes, and secret redaction remain intact. |
| Testability | PASS LOCALLY | Focused non-tax package, scheduler/provider/broker, operations-route, and contract E2E suites pass; monorepo typecheck passes. 20 live provider/device/hosted-resource tests remain opt-in. The broader sweep counts are retained in the closure audit rather than conflated with this focused gate. |
| AI behavior | CONDITIONAL | Open Agents target-specific matrix passes, and the production `agent_wallet` catalog exposes 17 grant-bound tools. A hosted read-only wallet workflow completed durably but emitted zero `tool.called` events because no compatible broker URL is configured. Hermes/Codex handshakes pass. Claude is credit-blocked; Computer Use is TCC-blocked. |

The Desk broker boundary has an additional live preview probe: the fresh
deployment `desk-v1-o5g0fgakk-bu-finance-007.vercel.app` returned `401` for an
unsigned request and `403 Workspace grant is invalid or expired` for a correctly
HMAC-signed request with a deliberately invalid grant. This demonstrates runtime
secret injection and signature verification while preserving the no-real-user
and no-real-wallet test boundary. It does not close hosted tool E2E because the
preview is not production and no valid member grant was exercised.

## Required production follow-ups

- Run authorized Pipedream, Magic Inbox, QuickBooks, Xero, Conta Azul, and
  Contabilium sandbox events through the deployed connector and scheduler.
- Configure the signed, protocol-compatible agent-tool broker and repeat a
  hosted wallet workflow that proves at least one read tool call and one
  approval-gated mutation path; a durable run with a natural-language summary
  alone is not tool E2E evidence.
- Run Redis/Postgres/Typesense saturation, noisy-neighbor, and kill/restart
  tests with resource metrics and a larger retrieval corpus.
- The four-fixture resource sample and five Railway metric samples are
  recorded, but they remain below saturation and do not close the capacity
  gate.
- Deploy the current command-center route and run authenticated browser and
  Expo/Cleo device journeys, including approval, cancellation, traces, and
  citations.
- Re-run Claude and Computer Use after credits and macOS TCC permissions are
  available.
- Produce one internal operating-week report with three workflows, five KPIs,
  linked traces, and zero unexpected spend.

Until those are attached to the evidence ledger, the correct status is
**production-ready code slice with open certification gates**, not 100% parity.
