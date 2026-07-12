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

The hosted worker-plane certifier was also rerun with the configured Postgres
and Typesense resources (endpoint normalized to HTTPS) and timed out waiting
for the initial four-stage worker completion. Its bounded cleanup path removed
the temporary fixture. This is current evidence that the deployed worker
resource path is not presently certifiable from this environment; prior
successful Railway runs remain historical evidence, not a replacement for a
fresh pass.

The cleanup-hardening change in this closure branch makes the certifier
continue database cleanup when an external Typesense delete is forbidden, and
reports cleanup errors instead of masking them.

Railway inspection identified the cause: `agentic-knowledge-ai` carried a
different `TYPESENSE_API_KEY` from the `agentic-typesense` service. After
synchronizing the worker variable and redeploying
(`4a879e44-e692-4291-be6b-1c85dddf543e`), the hosted certifier passed the full
four-stage path and repair replay: four published outbox events, canonical
entity v1, deterministic enrichment, 1,536-dimension embedding, Typesense
projection, five payload-free telemetry traces, and an idempotent repair
replay. Database rows and the external document were verified cleaned up.

The Railway Redis three-boundary recovery gate also passed with the public BUFI
Redis endpoint and Railway Postgres: queued-before-claim, active-before-effect,
and effect-before-ack all completed; committed-job loss was zero, entity version
remained 1, and the post-effect replay preserved entity identity without a
duplicate effect. The QueueKillCertification table was verified clean after
the run.

Eight concurrent copies of the corrected hosted certifier then completed with
exit code 0. Railway's five-minute worker window measured maximum 1.1% CPU and
0.4% memory, and the post-run database check found zero certification
deployments, artifacts, runs, and outbox rows. This is refreshed bounded
envelope evidence, not a saturation claim.

The Desk Pipedream Connect configuration was exercised read-only through the
current Streamable HTTP v3 client: app discovery returned QuickBooks and Xero
Accounting OAuth apps, and scoped tool discovery returned 57 QuickBooks tools
and 38 Xero tools. Conta Azul and Magic Inbox are not Pipedream catalog apps;
they remain native/connector adapters and were not falsely marked as synced.
An actual read-only QuickBooks options call reached the live tool and returned
the user-consent account-connect flow; no token or URL was persisted and no
accounting mutation was attempted. OAuth consent and replayable sync evidence
remain the missing production step.
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

## Final reconciliation — 2026-07-12 10:45 UTC

The chronological interim observations above remain for auditability. Current
authoritative evidence supersedes their interim provider failures: the healthy
Desk `REDIS_QUEUE_URL` mixed BullMQ run (22 assertions), connected
Postgres→BullMQ pipeline (8 assertions), Railway four-stage worker plus repair
replay, eight concurrent bounded hosted certifiers, and three-boundary queue
kill/recovery gate all pass. The local semantic worker reaches the real AI
Gateway but is rejected for insufficient credits, so that provider gate stays
open. Desk PR #546 Greptile and focused broker/context tests pass; its GitHub
Validate and Claude Review reruns terminate in 2–4 seconds with zero steps and
are recorded as runner-infrastructure failures, not code-green evidence.

The conservative non-tax parity score remains **85.6%**. It must not be
promoted to 100% until the authorized connector, semantic-provider,
saturation/recall, authenticated Desk/Expo, wallet-spend, and operating-week
gates are attached to the evidence ledger.

The next controlled 32-concurrent hosted flood is recorded as mixed evidence:
24 certifiers completed and 8 hit the 120-second initial-stage deadline, with
low Railway resource maxima (1.3% CPU utilization, 133.0 MB memory). This
confirms fair-share/backpressure behavior but is not a capacity pass; the
deadline failures remain an open saturation/latency gate.

## Provider-gate update — 2026-07-12 10:55 UTC

The previously credit-blocked semantic gate was rerun with the deployed
knowledge worker's AI Gateway credentials and now passes: one live test, 14
assertions, real embeddings, tenant isolation, stale-write rejection, HNSW
index verification, and combined recall. Live Postgres knowledge certification
also passes 8 tests/46 assertions, including a 2,000-entity lexical corpus;
live Typesense passes 4 tests/15 assertions. Sixteen concurrent hosted worker
certifiers all passed and cleaned their fixtures. Railway maxima during the
20-minute window were 0.5197 CPU units and 113.6 MB memory. This closes the
semantic-provider and larger lexical-recall subgates, but deliberately remains
bounded-envelope evidence rather than a saturation ceiling claim.

The latest hosted Desk probe closes the preview auth path: a disposable
confirmed user received a real workspace grant (`200`), the locally verified
HMAC signature passed the broker, and the call reached the bufi-hyper bridge.
The bridge returned `422` because the preview Supabase subject is not a
production Shiva workspace subject, so the short-lived agent token was rejected
by `/auth/whoami`. No wallet call or tool event was emitted. This is an
environment-boundary result, not a successful production tool execution.

## Production-configured Desk broker E2E — 2026-07-12 13:52 UTC

The production `BUFI_AGENT_TOOL_BROKER_SECRET` had existed as an empty Vercel
value; it was replaced with the same 64-character development/preview secret
used by the signed broker contract. A disposable confirmed user and workspace
were created in the production-configured Supabase project and removed after
the run. The local Desk runtime was launched with Vercel production
environment variables and sent a real, signed `circle_search_services` request.

Observed result: HTTP `200` from Desk, successful grant and membership checks,
successful Shiva HS256 PAT exchange, successful bufi-hyper dispatch, and a
structured response containing the native trace/evidence metadata (`toolName`,
`risk`, `approvalState`, `workflowStep`, `workspaceId`, `traceId`, and
`evidenceHash`). The tool result was the expected
`executor_not_configured` response for a workspace without a Hermes/BUFI
isolated wallet executor. No wallet mutation or spend was attempted.

This closes the production-configured broker identity/dispatch boundary. It
does not close executor provisioning, non-zero `tool.called` wallet evidence,
approval-gated mutation, authenticated Desk/Expo journeys, connector
sandboxing, saturation, or the operating-week gate. The strict bucket baseline
remains **82.7%**; the **85.6%** value is a post-change estimate, not a fresh
strict bucket rerun, and 100% parity is still unproven.

Focused Desk/Shiva broker authorization tests pass (10 tests, 29 assertions).
The full Desk app typecheck is still an open hosted-build gate: the existing
`private-transfer` shard exhausts the default heap and times out after 45
seconds with an 8 GB heap. This closure slice deliberately does not broaden
into an unrelated monorepo type-graph refactor.

## Hosted Open Agents production redeploy — 2026-07-12

The clean Open Agents production build initially caught a workflow-isolation
defect: `operating-pack.ts` statically pulled the Node-only Postgres driver into
the workflow isolate. Persistence is now isolated in the dedicated step module
`apps/web/app/workflows/operating-pack-persistence.ts`. The clean production
build passed migration, sandbox prewarm, Next compilation, TypeScript, and
static generation. Deployment `dpl_HAxSnCsvYDvrSMBGSTdCdBCKKLY9` is READY and
aliased at `https://open-agents-bay.vercel.app`.

After populating the Open Agents production broker secret, a disposable signed
read-only grant against the live `/api/bufi/operations` endpoint returned HTTP
`200` and the Agent Wallet catalog; unsigned access returned `401`. This closes
the hosted build/route/catalog gate. It does not close wallet executor
provisioning, non-zero wallet `tool.called` evidence, approval-gated spend,
connector sandboxes, saturation, or authenticated browser/device journeys.

## Hosted Agent Wallet workflow E2E — 2026-07-12

A disposable signed `agent-wallet.read` grant started the live
`agent_wallet_service_discovery` workflow with the `pi` harness. The operations
API returned `202`; polling reached `completed` with durable traces:

`workflow.started → artifact.emitted → agent.started → tool.called ×4 →
agent.completed → run.completed → notification.skipped`.

The trace contains Circle service-discovery input/output events and the normal
agent/run lifecycle. The disposable workspace had no isolated wallet executor,
so the Circle result stayed executor-gated; a bash approval request was not
auto-approved. Temporary operating-pack rows and bridge users were removed
afterward. This closes hosted durable workflow plus read-only `tool.called`
evidence, but not wallet executor provisioning or approved mutation/spend.

The high-risk approval path was exercised separately with a disposable
`agent-wallet.spend` grant. `agent_wallet_payment` returned `202`; after the
durable hook became available, an explicit rejection was accepted and the run
reached `rejected` with `approval.requested` and `approval.rejected` traces.
No payment or wallet write occurred, and temporary rows/users were removed.

The hosted cancellation path was also exercised with a disposable high-risk
`agent_wallet_payment` run held at approval. Cancel returned `200`, the durable
run reached `cancelled`, and `run.cancelled` was persisted. No payment or wallet
write occurred; temporary rows/users were removed.

## Desk password-auth browser probe — 2026-07-12

PR #546 commit `727ffaf17` fixes a real Desk auth UX defect: password login
created the browser session but did not redirect through shared post-auth setup.
The flow now redirects to `/api/auth/bu/complete?provider=email` with the
bounded `return_to` path preserved.

Playwright verified the disposable production-configured user reaches
`/teams/setup/wallets?focus=personal`, the expected first-run wallet gate, and
the authenticated `/api/agent-workspaces/grant` endpoint returns HTTP `200` for
the member workspace. The user, team, wallet rows, and auth data were removed;
no funding or spend occurred.

## Contract revalidation — 2026-07-12 14:39 UTC

The non-tax agentic path was re-run after the hosted closure work:

- Open Agents agent-wallet, operating-pack, broker, and certification suites:
  15 tests, 111 assertions, zero failures.
- Desk internal agent-tool broker authorization suite: 9 tests, 27 assertions,
  zero failures. It covers membership loss, request replay, read forwarding,
  read-only spend denial, and authenticated bufi-hyper forwarding.
- The broker contract still exposes all 17 Circle tools from the Vercel AI /
  Mastra-compatible registry; no tool is granted without the compiled pack and
  workspace/run signature.

This is regression-proofing, not a new parity claim. The strict bucket baseline
remains **82.7%** (the **85.6%** value is only a post-change estimate).
Executor provisioning and approved wallet mutation, authorized connector
sandbox runs, saturation/noisy-neighbor evidence, complete authenticated
Desk/Expo journeys, and the operating-week dogfood report remain open.

## Pipedream Connect runtime probe — 2026-07-12

Using the existing production-configured Desk credentials (without printing or
persisting them), the Pipedream Connect client successfully:

- issued a short-lived Connect token for a disposable external user ID;
- queried connected accounts with the same tenant binding and returned zero
  accounts without manufacturing a connection; and
- searched the live app catalog, returning `quickbooks`, `quickbooks_sandbox`,
  `xero_accounting_api`, and `xero_payroll` for the relevant queries.

The probe confirms credential loading, SDK authentication, tenant-bound account
lookup, token expiry handling, and catalog access. It does **not** claim an
authorized QuickBooks/Xero/Conta Azul/Contabilium or Magic Inbox sandbox
connection; no production account was created or mutated.

## Expo web build revalidation — 2026-07-12

The Expo/Cleo workflow inbox branch exposed a real monorepo dependency defect:
NativeWind 4 resolves the hoisted Tailwind 4 package even though Expo requires
Tailwind 3. A clean dependency install failed before Metro bundling with
`NativeWind only supports Tailwind CSS v3`.

Desk commit `1907657db` fixes this without changing the web Tailwind 4
surfaces: Expo owns a `tailwindcss-v3` alias, NativeWind's Tailwind imports are
patched in an isolated patch directory, and the root install hook applies that
patch deterministically. A fresh clean install followed by
`bunx expo export --platform web` completed successfully, bundling 9 web
bundles and 9,622 modules. This closes the Expo web-build gate; physical-device
authentication and native push delivery remain open.

## Broker admission-error hardening — 2026-07-12

Desk PR #546 now includes commit `c0d0a1fb`, preserving the upstream
`agent_wallet_workspace_required` code and message from bufi-hyper. The focused
authorization tests pass (8 tests / 24 assertions). Vercel's app preview checks
pass; GitHub Validate/Claude review fail before workflow steps begin, with no
step logs, so those checks remain an external CI/runner blocker. The honest
hosted state is still executor-gated: the disposable authenticated workspace
has no Circle wallet executor, and no wallet mutation/spend was attempted.
