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

The Desk broker boundary has an additional live preview probe: the clean
current-development deployment `desk-v1-5y61v3sxw-bu-finance-007.vercel.app` returned `401` for an
unsigned request and `403 Workspace grant is invalid or expired` for a correctly
HMAC-signed request with a deliberately invalid grant. This demonstrates runtime
secret injection and signature verification while preserving the no-real-user
and no-real-wallet test boundary. It does not close hosted tool E2E because the
preview is not production and no valid member grant was exercised.

Desk commit `dfbfc8d44` closes the request-shape mismatch with Open Agents by
accepting and preserving `agentRunId`/`traceId` in the strict broker schema and
persisting the exact incoming trace identity on knowledge packets. Commit
`dfe772eae` also binds supplied workflow/agent/trace identity into the
append-only context-packet artifact hash (without exposing it in the packet
payload), preventing immutable dedupe from retaining stale trace linkage. The
focused Desk suite now passes 16 tests and 43 assertions. The fix is isolated
on a clean current-development branch in Desk PR #546; the superseded PR #545
was closed to remove unrelated accounting scope.

Desk commit `fa912e800` extends the route to the complete Circle registry and
the bufi-hyper MCP bridge. The route verifies the grant scope per tool, uses a
15-minute Shiva PAT for the workspace member, forwards only bounded tool input,
and denies spend calls without `agent-wallet.spend`. Eleven focused tests and
31 assertions pass; this is still a local/contract gate until a real production
member grant exercises the hosted path.

The live bufi-hyper manifest reports 117 tools, including every Circle tool in
the Open Agents registry. Forced Desk preview `dpl_4xKAH8euYUVusRho3hFQ6fhAugd7`
reached READY and passed the unsigned 401 plus signed-invalid-grant 403 probes.
That is deployment and schema evidence only; no real member grant or wallet
call has been claimed.

The latest local live certification rerun produced report hash
`sha256:723a8595a48ae7b68dc7d88b7d5417124125132396d82a607582919a2edc7b5c`.
It confirms Open Agents dispatch, Hermes, Codex, Circle wallet read-only, and
Hyper manifest checks. Claude exits with `Credit balance is too low`; Computer
Use doctor reports missing Accessibility and Screen Recording grants. These
are honest external blockers, not substituted contract evidence.

Open Agents commit `70701f36` adds bounded, cancellation-aware agent execution
policy with retry traces; mutation-capable agents are explicitly non-retryable.
The policy suite passes 3 tests and the web typecheck passes.

The worker-plane resource gate was strengthened with eight concurrent hosted
certifiers: all eight completed and cleaned up, with observed maxima of 1.4%
CPU and 0.4% memory. Gateman still treats this as bounded-envelope evidence,
not saturation evidence.

The live queue/data-plane gate was rerun against the healthy BUFI Desk worker
Redis configuration: the mixed BullMQ workload passed 22 assertions and the
connected Postgres→BullMQ pipeline passed 8 assertions. The semantic-worker
variant reached AI Gateway but was rejected for insufficient credits, so its
embedding-provider claim remains conditional.

Railway hosted-worker certification subsequently passed after correcting the
worker/Typesense key mismatch and redeploying the AI worker. The run observed
four published stages, canonical/enrichment/1,536-dimension embedding/
Typesense projection, five payload-free telemetry traces, and an idempotent
repair replay; all database and external fixtures were cleaned up.

The three-boundary Redis/Postgres kill gate also passed: queued-before-claim,
active-before-effect, and effect-before-ack all recovered with zero committed
job loss, stable entity identity/version, and zero duplicate effects. Its
temporary QueueKillCertification rows were verified absent afterward.

The two tangential Desk attempts were evaluated before closure: #495's guarded
wallet tools were consolidated into the still-open #540 boundary, while #438's
monorepo-wide AI SDK/artifact migration was superseded by the isolated Open
Agents runtime. Neither should be cherry-picked into this non-tax slice.

## Required production follow-ups

- Run authorized Pipedream, Magic Inbox, QuickBooks, Xero, Conta Azul, and
  Contabilium sandbox events through the deployed connector and scheduler.
- Configure the signed, protocol-compatible agent-tool broker and repeat a
  hosted wallet workflow against Desk's new bufi-hyper bridge that proves at
  least one read tool call and one approval-gated mutation path; a durable run
  with a natural-language summary alone is not tool E2E evidence.
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
