# Agentic Workspaces non-tax closure audit — 2026-07-12

This is the implementation and evidence delta for the non-tax Agentic
Workspaces chain. Tax Automation Engine and tax-agent files are intentionally
out of scope for this audit.

## Implemented in this closure pass

- Knowledge workers now run a bounded freshness scheduler when an explicit
  workspace allowlist is configured. It scans canonical `SourceArtifact`
  entities, checks the version/age-bound Typesense projection, and enqueues a
  stable repair job containing only artifact lineage. Repeated scans replay the
  same job instead of creating duplicate work.
- The worker exposes repair freshness, error, scheduled, and replay counters in
  `/readyz`; stale repair failures fail readiness. Configuration is explicit:
  `KNOWLEDGE_REPAIR_INTERVAL_MS`, `KNOWLEDGE_REPAIR_MAX_AGE_MS`, and
  `KNOWLEDGE_REPAIR_BATCH_SIZE`.
- The host operating-pack broker and internal harness protocol now carry the
  complete Circle Agent Wallet registry: session, setup, wallet, Gateway,
  service discovery, free-service, x402 inspection, payment, and deposit tools.
  Each call remains workspace/run signed and is still limited by compiled
  grants; the broker does not persist credentials or raw provider responses.
- The operating-pack workflow registers Circle capabilities with explicit
  scopes, operations, and approval boundaries. Agent lifecycle traces now emit
  `agent.started` and `agent.failed` in addition to the existing completion and
  tool traces.
- A dedicated `agent_wallet` operating pack now publishes all 17 Circle wallet
  tools as grant-bound workflows: onboarding, service discovery, and payment.
  Wallet mutation and USDC spend tools are approval-required in the manifest.
- Desk's Operations command center can select Codex in addition to Claude Code
  and Pi. The external Hermes adapter remains a harness-runner concern rather
  than being silently presented as an in-process adapter.
- Canonical source-artifact identity now covers Pipedream, Magic Inbox,
  QuickBooks, Xero, Conta Azul, and Contabilium metadata-only records. Provider
  payloads remain outside the artifact envelope.
- Local harness certification no longer attributes one generic contract,
  Hyper, or Circle observation to every external harness. Those observations
  are scoped to Open Agents; each external target receives only its own
  handshake/doctor evidence.
- The deployed Railway worker plane now has an explicit repair workspace
  allowlist and bounded freshness configuration. Four concurrent hosted
  source→enrichment→embedding→Typesense fixtures completed and cleaned up;
  five Railway resource samples stayed below 0.3% CPU and 0.6% memory. This is
  a bounded-envelope observation, not a capacity saturation claim.
- Production queue telemetry is now wired end to end. All three worker modes
  target the production `/api/internal/queue-telemetry` route, the shared
  secret is present on Vercel, and the live certification accepted one export
  plus an exact replay while persisting one payload-free trace with three SLO
  alerts. See the [resource certification](./2026-07-12-agentic-workspaces-resource-certification.md).
- Desk's internal broker now accepts the complete Circle Agent Wallet registry
  and forwards granted Circle calls to the bufi-hyper MCP through a short-lived
  Shiva agent token. Read and spend scopes are explicit; spend grants require
  explicit confirmation and expire after 15 minutes. The clean Desk
  authorization suite now passes 11 tests and 31 assertions, including read
  forwarding and read-only spend denial. Hosted execution remains uncertified
  until the production Desk endpoint has service-token wiring and a real member
  grant.

- The live bufi-hyper MCP manifest currently exposes 117 tools, including the
  complete Circle Agent Wallet registry. A fresh Desk preview deployment
  (`dpl_4xKAH8euYUVusRho3hFQ6fhAugd7`) built successfully with 298 static pages
  and the `/api/internal/agent-tools` route. An unsigned request returned 401;
  an HMAC-signed Open Agents-shaped `circle_search_services` request was
  accepted by the strict schema and rejected only at the deliberately invalid
  grant with 403. This proves deployment and protocol-shape parity, not a real
  member or wallet execution.

## Verification

The non-tax package sweep is green:

```text
169 pass
20 skip (opt-in live provider/device/hosted-resource cases)
0 fail
561 expect() calls
```

The monorepo typecheck is green across 19 targets. Focused checks also pass:

- knowledge-worker config and repair scheduler
- Circle broker full-registry forwarding
- connector provider identity envelope
- agentic workspaces and horizontal ERP contract E2E
- agent-wallet pack, grant-scope enforcement, and hosted catalog contract

The latest live harness report was generated on 2026-07-12 with report hash
`sha256:723a8595a48ae7b68dc7d88b7d5417124125132396d82a607582919a2edc7b5c`.
Open Agents passed its target-specific matrix; the live Open Agents dispatch,
Hermes handshake, Codex handshake, Circle wallet read-only check, and
bufi-hyper tools/list all passed. Claude Code remains blocked by the local
`Credit balance is too low` response; Computer Use remains blocked by macOS
Accessibility and Screen Recording/TCC. The configured live BullMQ Redis run
still fails with `Connection is closed`; its certification teardown is now
bounded so an unavailable provider does not leave the test process hanging for
a minute.
The current production alias was redeployed after the UUID, grant-scope, and
fail-closed broker fixes (`dpl_4hczh3YXgimg1knn3mRJ2f5ZNUy1`); an authenticated
workspace-grant GET to `/api/bufi/operations` returned
200 and exposed the `agent_wallet` pack with 17 tool grants and three
workflows. A hosted read-only `agent_wallet_service_discovery` run also
completed durably, but emitted **zero tool events**: the model returned a
summary without invoking the declared tools. This is explained by the
production configuration having no `BUFI_AGENT_TOOL_BROKER_URL`; the direct
`mcp.bu.finance/mcp` endpoint is not a compatible broker protocol and returns
`agent_wallet_auth_required` without a signed workspace session. The broker
secret is provisioned as a sensitive Vercel environment variable; its value is
not stored in this repository or audit output. Therefore the hosted catalog is
certified, while hosted tool execution is not.

The Desk-side signed broker route was deployed to a clean current-development
preview (`desk-v1-5y61v3sxw-bu-finance-007.vercel.app`).
An unsigned request returned `401 Unauthorized`; a correctly signed HMAC request
then reached grant verification and returned `403 Workspace grant is invalid or
expired`. This proves runtime secret injection and signature verification without
using a real member, workspace, or wallet. The route is not promoted to Desk
production because the current production build still has unrelated pre-existing
contract type debt, and the preview URL is not a durable production broker.
The latest forced preview is `desk-v1-g0h2lqhs7-bu-finance-007.vercel.app`
(`dpl_4xKAH8euYUVusRho3hFQ6fhAugd7`) and is READY; it repeats the same 401/403
boundary probe after the full Circle bridge and runtime-env whitelist landed.

The broker contract was corrected in Desk commit `dfbfc8d44`: strict request
validation accepts Open Agents' `agentRunId` and `traceId`, and knowledge
packets preserve both identities instead of substituting the grant subject or
dropping the incoming trace. The refreshed preview accepted the full signed
Open Agents-shaped request before rejecting only its deliberately invalid grant;
the focused Desk authorization suite is green. Commit `dfe772eae` additionally
binds supplied workflow/agent/trace identity into the immutable context-packet
artifact hash, without exposing identity in the public packet payload, so
duplicate persistence cannot retain stale trace linkage. The combined Desk
context-packet, broker, and grant suite is green (16 tests, 43 assertions).

The live certification rerun against the currently configured Redis endpoint
reproduced `Connection is closed` in both the BullMQ runtime and the connected
Postgres→BullMQ pipeline. Commit `16e36eb1` bounds connected-pipeline teardown
so this provider failure exits in roughly 25 seconds instead of hanging the
process. This improves failure hygiene but is not production queue evidence.

The same live gates were then rerun against the healthy `REDIS_QUEUE_URL`
already configured for the BUFI Desk worker (without printing or persisting its
credential): the mixed BullMQ workload passed (22 assertions) and the full
Postgres→BullMQ source→canonical→enrichment→embedding→projection pipeline
passed (8 assertions). Commits `8de6f6d6` make both integration tests discover
`REDIS_QUEUE_URL`/`REDIS_URL` as standard fallbacks. The semantic-worker gate
reached the real AI Gateway but was rejected with `A positive credit balance is
required for all requests`, so that provider-backed embedding claim remains
open.
The fix is isolated on a clean current-development branch and published as Desk
PR #546; superseded PR #545 was closed because its older branch also carried
unrelated accounting commits.

Desk commit `fa912e800` extends that boundary to the complete Circle registry:
the route enforces `agent-wallet.read` versus `agent-wallet.spend`, mints a
short-lived user PAT through Shiva, and invokes the matching bufi-hyper MCP
tool with workspace/run/trace headers. Its test fixture covers the full grant
and MCP response shape without persisting credentials or provider payloads.
The same commit whitelists the required GoCardless environment variables in
Turbo's app build task; a local production build now reaches the repository's
pre-existing contract/type debt instead of failing during env loading.

Open Agents commit `70701f36` adds a durable per-agent execution envelope:
bounded cancellation (`BUFI_AGENT_STEP_TIMEOUT_MS`), bounded attempts
(`BUFI_AGENT_MAX_ATTEMPTS`), explicit `agent.retry` traces, and attempt-aware
message/trace identities. Automatic retries are restricted to read-only agents;
wallet writes and payments remain single-attempt to prevent duplicated external
effects. The policy tests and the web package typecheck pass.

The hosted worker plane was rerun at eight concurrent certifiers with the
Typesense cleanup credential supplied out-of-band. All eight completed the
canonical/enrichment/embedding/projection/repair path, each reporting
`queued=4` and `completed=4`; observed maxima were 1.4% CPU and 0.4% memory,
and a post-run query confirmed zero certification fixtures remained. This
improves bounded-envelope evidence but does not count as saturation proof.

PR #495 is closed, with its guarded wallet-tool implementation explicitly
consolidated into the still-open tax/agent boundary PR #540 (commit
`9ada79c3a`); the clean broker path here keeps the non-tax runtime independent
of that tax landing sequence. PR #438 is also closed and superseded by the
narrower #540 plus Open Agents' isolated AI SDK runtime; cherry-picking its
monorepo-wide SDK/artifact churn would add no missing Agentic Workspaces
capability and would create a conflict surface.

## Honest parity status

The prior strict non-tax score was 82.7%. The code changes above improve the
worker freshness, Circle registry, provider identity, lifecycle trace,
command-center, hosted-auth, and operating-pack slices, but they do not prove
all external state. A conservative post-change estimate is **85.6%**, not
100%.

The following gates remain required before claiming 100%:

1. authorized Pipedream, Magic Inbox, QuickBooks, Xero, Conta Azul, and ERP
   sandbox events through the deployed connector path;
2. production Redis/Postgres/Typesense CPU, memory, connection, provider
   latency, noisy-neighbor, and kill/restart saturation evidence. The current
   four-fixture sample is explicitly below saturation and is recorded only as
   bounded-envelope evidence;
3. larger hybrid-recall and freshness-load evidence beyond the now-enabled
   scheduled repair cycle;
4. authenticated Desk browser launch/approve/reject/cancel/traces/citations;
5. Expo/Cleo physical-device workflow and approval evidence;
6. a funded Claude account and macOS Accessibility/Screen Recording approval;
7. one connected internal operating-week report with three workflows, five
   KPIs, trace links, and zero unexpected spend;
8. an authenticated, protocol-compatible broker endpoint and a hosted wallet
   run with non-zero `tool.called` traces;
9. authenticated Desk browser launch/approve/reject/cancel/traces/citations
   and a current hosted citation path beyond the authenticated catalog GET.

The latest alias probe now returns `401 Unauthorized` for the operations API and
`307` to the authenticated UI route. Earlier cached 404/HTML observations were
deployment-staleness artifacts; route certification should still use an
authenticated deployment URL and deployment ID rather than infer health from an
unauthenticated page.

These are evidence/deployment gates, not reasons to weaken the code contract.
