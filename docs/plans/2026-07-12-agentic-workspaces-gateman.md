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

Open Agents commit `69c94a80` adds a startup Typesense credential check to the
long-running knowledge worker. A present-but-invalid key now fails deployment
startup instead of allowing a superficially healthy worker to accumulate
projection failures; the worker config suite and package typecheck remain
green.

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

## Current revalidation — 2026-07-12 15:05 UTC

The earlier hosted-wallet observation above is retained as historical evidence
from the deployment where no compatible broker URL was configured. It is not
the latest state. The current hosted deployment has since completed a signed
read-only `agent_wallet_service_discovery` workflow with non-zero Circle
`tool.called` traces, and separate hosted approval-rejection and cancellation
runs. Those traces are recorded in the closure audit.

The current remaining gates are unchanged in substance: an isolated wallet
executor is still not provisioned for disposable workspaces, so no approved
wallet mutation or spend has been attempted; provider sandboxes, saturation,
authenticated browser/device journeys, and the operating-week report remain
open. The Expo web-build prerequisite is now green after Desk commit
`1907657db` and a clean 9,622-module export.

## Final reconciliation — 2026-07-12 10:45 UTC

Chronological interim failures above are retained for auditability. Current
evidence is green for healthy Desk Redis BullMQ, connected Postgres→BullMQ,
Railway worker processing plus repair replay, eight concurrent bounded hosted
certifiers, and three-boundary queue kill recovery. The local semantic worker
reaches AI Gateway but is credit-blocked. Desk PR #546's Greptile and focused
broker/context suite pass, while GitHub Validate/Claude Review reruns terminate
with zero steps and remain runner-infrastructure failures. The conservative
non-tax verdict is therefore **85.6%, not 100%**; external connector,
provider, saturation, authenticated Desk/Expo, wallet-spend, and operating-week
gates remain open.

Gateman records the subsequent 32-concurrent flood as mixed, not green:
24/32 certifiers completed, while 8 reached the 120-second initial-stage
deadline. Low Railway resource utilization (1.3% CPU, 133.0 MB memory) points
to fair-share/provider latency rather than host exhaustion. The deadline
failures remain a required capacity/latency follow-up.

## Provider-gate update — 2026-07-12 10:55 UTC

Gateman evidence is strengthened by fresh live runs: semantic retrieval passed
with the deployed AI Gateway credential (1 test/14 assertions), live Postgres
knowledge passed 8 tests/46 assertions including 2,000 lexical filler entities,
and live Typesense passed 4 tests/15 assertions. Sixteen concurrent hosted
worker-plane certifiers all completed and cleaned up. Railway maxima were 0.5197
CPU units and 113.6 MB memory in the 20-minute window. The semantic-provider and
larger lexical-recall subgates are now green; the resource result is still a
bounded envelope, not saturation proof. The verdict remains **85.6%, not 100%**
until authorized connectors, authenticated clients, wallet-spend, and operating
week evidence are attached.

## Hosted broker probe — 2026-07-12 12:20 UTC

The clean Desk preview was redeployed after replacing stale branch-scoped
preview secrets with one encrypted preview value. A disposable, confirmed
Supabase user and workspace exercised the real grant endpoint: the grant
returned `200`, its HMAC verified locally against the preview/development
secret, and the broker request signature passed Desk authentication and
workspace membership checks. The request reached the bufi-hyper bridge and
returned `422 BUFI hyper agent tool failed` because the disposable preview
Supabase subject is not a production Shiva workspace subject; the minted
short-lived Shiva agent token is therefore rejected by bufi-hyper's
`/auth/whoami`. No tool event or wallet mutation was produced. This closes the
Desk-side auth/signature/grant path but not a successful production
`tool.called` execution. A real production Desk member grant remains required.

## Production-configured Desk broker E2E — 2026-07-12 13:52 UTC

The missing production broker secret was corrected in the Desk Vercel project
(the prior production value was present but empty). A disposable, confirmed
Supabase user and workspace were created in the production-configured database,
the workspace membership was inserted, and a real Desk broker request was sent
from the local Desk runtime loaded with production environment variables.

The request completed the full non-mutating path:

1. Desk accepted the HMAC request and verified the workspace grant.
2. Desk verified the disposable member's workspace membership.
3. Desk minted an HS256 Shiva agent PAT; Shiva's deployed production worker
   accepted it after the explicit algorithm fix in `f4aa04620`.
4. Desk reached `mcp.bu.finance` and returned HTTP `200` for
   `circle_search_services`.
5. The response included native `toolName`, `risk`, `approvalState`,
   `workflowStep`, `workspaceId`, `traceId`, and `evidenceHash` metadata.

The result was the expected `executor_not_configured` response because this
disposable workspace has no Hermes/BUFI isolated wallet executor attached. No
wallet was created, funded, deployed, or spent from. This closes the
production-configured auth/grant/identity/dispatch boundary, but not executor
provisioning, authenticated browser/Expo journeys, connector sandboxes,
saturation, or the approval-gated mutation gate.

The strict bucket-analysis baseline remains **82.7%**. The earlier **85.6%**
figure is retained as a post-change implementation estimate, not a fresh strict
score; this E2E result is evidence for the broker bucket only and must not be
converted into 100% parity.

The focused Desk/Shiva broker authorization suite passes 10 tests and 29
assertions. The full Desk app typecheck remains an open hosted-build gate: the
`private-transfer` shard exceeds the default heap and times out after 45 seconds
even with an 8 GB heap. No unrelated type-graph refactor was folded into this
non-tax closure slice.

## Expo/Cleo simulator revalidation — 2026-07-12

The Expo wallet services now import the browser-safe Circle modular subpaths
instead of the Node-only `@bu/circle` barrel. The iOS release bundle embeds
successfully, and a direct Xcode Release simulator build succeeds. Installing
that binary and launching it on iPhone 16 Pro simulator reached the app's JS
runtime; the first launch exposed a second native defect where Hermes does not
provide the browser `crypto.randomUUID` global. The app now uses the native
`expo-crypto` UUID API for chat, workflow idempotency, and invoice IDs.

After rebuilding, the simulator launches without the UUID abort. The launch
then fails closed at the expected environment boundary (`supabaseUrl is
required`) because this isolated worktree has no Supabase runtime credentials.
This proves native build, embedded bundle, and crash-free startup through the
UUID boundary; it does **not** prove an authenticated Expo/Cleo workflow,
approval/cancellation journey, push delivery, or wallet mutation. Those remain
open device gates and no credentials were added to the repository.

## Hosted Open Agents production redeploy — 2026-07-12

The production build initially exposed a real workflow-isolation defect: the
operating-pack workflow statically imported the Node-only Postgres client. The
database persistence calls are now isolated behind a dedicated step module in
`apps/web/app/workflows/operating-pack-persistence.ts`. The clean production
build completed successfully (including TypeScript and static generation) and
the alias was promoted to `https://open-agents-bay.vercel.app` at deployment
`dpl_HAxSnCsvYDvrSMBGSTdCdBCKKLY9`.

The production broker secret was also populated for the Open Agents project.
An authenticated, signed read-only request against
`/api/bufi/operations` then returned HTTP `200` from the live alias and exposed
the Agent Wallet catalog with its Circle tool grants. An unsigned request still
returns HTTP `401`. This closes the hosted route/build/catalog gate; it does not
prove a real wallet executor, external connector sandbox, browser/device
journey, or approval-gated spend.

## Hosted Agent Wallet workflow E2E — 2026-07-12

Using a disposable signed `agent-wallet.read` grant, the live alias accepted a
read-only `agent_wallet_service_discovery` workflow with the `pi` harness and
returned `202` with a durable execution and workflow run ID. Polling the live
operations route reached `completed` and returned this trace sequence:

`workflow.started → artifact.emitted → agent.started → tool.called ×4 →
agent.completed → run.completed → notification.skipped`.

The trace includes `circle_search_services` input/output events and native
agent/run lifecycle records. The Circle result remains executor-gated for the
disposable workspace; a bash approval request was correctly not auto-approved.
All temporary operating-pack rows and bridge users were removed after the run.
This closes the hosted durable workflow and non-zero `tool.called` evidence
gate for a read-only tool, but not wallet executor provisioning or approved
mutation/spend.

## Desk password-auth browser probe — 2026-07-12

The Desk browser probe found and fixed a real UX defect in PR #546: password
authentication established the Supabase browser session but never redirected
through the shared post-auth setup route. Commit `727ffaf17` now sends a
successful password login to `/api/auth/bu/complete?provider=email` while
preserving the bounded `return_to` path.

With a disposable confirmed production-configured Supabase user, Playwright
observed the live local Desk flow redirecting to
`/teams/setup/wallets?focus=personal`, proving authenticated post-login routing
and the expected first-run wallet setup gate. The authenticated grant endpoint
then returned HTTP `200` for the disposable team workspace. The disposable
user, team, wallet rows, and auth data were removed after the run; no wallet
funding or spend occurred.

The hosted cancellation gate was exercised with a disposable high-risk
`agent-wallet_payment` run held at the approval boundary. The cancel action
returned `200`, the durable run reached `cancelled`, and the trace contained
`run.cancelled`. No wallet or payment mutation occurred; temporary rows and
the bridge user were removed afterward.

The hosted high-risk approval gate was also exercised with a disposable
`agent-wallet.spend` grant. `agent_wallet_payment` returned `202`, initially
returned a safe `409` while the durable hook was still being registered, then
accepted the explicit rejection and reached `rejected`. The resulting trace
contained `approval.requested` and `approval.rejected`; no payment, wallet
write, or external mutation occurred. Temporary rows and the bridge user were
removed after the run.

## Authenticated Desk command-center browser dogfood — 2026-07-12

Playwright used the existing confirmed Hermes test account and a freshly minted
Supabase magic-link session against the production-configured Desk preview. The
real `/agent-workspaces` page rendered the pack catalog, Circle grant matrix,
launch controls, recent operations, specialist roster, workflow timeline, trace
count, and evidence-context panel.

The browser launched `finance_ops / weekly_finance_review` through the rendered
form. Desk returned `202`, materialized two agents, and the timeline rendered
`workflow.started`, `artifact.emitted`, and two `agent.started` traces. The
workflow was then cancelled through the rendered **Cancel** control; the browser
observed the POST action and HTTP `200`, and the authenticated run resolver
returned terminal `cancelled` with a persisted `run.cancelled` trace. No wallet
or payment mutation occurred.

The dogfood also exposed a real rate-limit interaction: the previous 2-second
poll loop exhausted the sensitive endpoint while a run was open. Desk commit
`73d775f9e` changes active polling to 10 seconds and terminal polling to 30
seconds, leaving explicit controls available for the human.

The same authenticated session then launched the high-risk
`agent_wallet_onboarding` pack with the Claude Code harness. Desk returned
`202`, the resolver reached `awaiting_approval`, and the browser rendered the
Approve/Reject/Cancel controls. Rejecting through the rendered **Reject**
control returned HTTP `200`; the resolver reached terminal `rejected`, with
`approval.requested` and `approval.rejected` traces and no wallet mutation.
This closes the authenticated browser launch/cancel/approval-rejection/timeline
trace slice for the non-tax command center.

Desk commit `8219e4c1b` also fixes evidence selection when a run has multiple
context packets: the panel now prefers the newest packet with populated
citations and falls back to the newest packet only when none are populated.
The focused component suite passes 4 tests. A fresh Vercel preview deployment
(`dpl_9skv7pcNPVXarNpCHJkdbvmDDaxk9`,
`desk-v1-o8m7nt457-bu-finance-007.vercel.app`) builds successfully, but its
runtime environment is not configured for the agent-workspace broker
(`503 Agent workspace runtime is not configured`), so the citation row cannot
yet be certified on that preview. The citation implementation and unit proof
are recorded. The prior production-configured preview independently returned
HTTP 200 for 15 authenticated context-packet fetches, including a populated
packet with 10 references/citations; its old panel selected a later empty
packet and displayed `0 citations`, which is the defect the new commit fixes.
The fixed preview was subsequently redeployed with the existing shared BUFI
broker secret at deployment `dpl_BNwRHbUrNj1mDJc5iUVBqZWvFRLu`
(`desk-v1-20jt8uyxh-bu-finance-007.vercel.app`). A fresh authenticated browser
run fetched 15 packet responses, including populated packets with 5, 10, and
17 citations, and rendered `Verified ContextPacket`, `10 citations`, and
`[c1]`–`[c10]` in the panel. The hosted citation gate is now closed.

The same fixed preview launched a new high-risk wallet onboarding run with the
Claude Code harness (`op_eUuHVidgE1iCN61pjBbKdugy`), returned `202`, reached
`awaiting_approval`, and rendered the approval controls. Rejecting through the
rendered control returned HTTP `200`; a fresh authenticated resolver then
returned terminal `rejected` with `approval.requested` and
`approval.rejected` traces. No wallet mutation occurred.

Expo/Cleo authenticated device and push, real Circle wallet executor, provider
sandbox, production capacity-ceiling, Claude/TCC, and operating-week evidence
gates remain open. Wallet execution remains deliberately unconfigured.

## Production worker ceiling probe — 2026-07-12

A bounded 64-concurrent certifier flood against the isolated production
certification workspace completed 60 runs and failed 4 at the five-minute
deadline. Railway recorded 0.5958 vCPU maximum of 24 and 145.9 MB maximum of
24,576 MB. Gateman classification: this is real backpressure/deadline evidence,
not CPU/memory saturation and not a pass. Provider latency, database/connection
ceilings, admission fairness, and failure classification remain open.

The telemetry sink was then hardened with bounded transient retries (focused
suite: 9 tests / 30 assertions) and deployed cleanly to Railway deployment
`fa1b30e3-9d61-4e42-a05d-8b7a0c7e9096`. Repeating the same 64-concurrent probe
improved completion from 60/64 to **61/64**, but three certifiers still failed
with telemetry delivery pressure. Gateman verdict: improvement verified;
capacity gate still open.

The Open Agents telemetry ingress diagnostic deployment
`dpl_9vYHG2uSY75a8fHu4YJPtWJSfeHr` was healthy, and a post-deploy
16-concurrent certifier probe completed 16/16. The clean lower-load result
confirms the remaining failure boundary is high-concurrency ingress/backpressure,
not baseline configuration.

## Telemetry repair-ledger remediation — 2026-07-12

The diagnostic ingress logs isolated the original persistence error to repair
trace IDs that do not correspond to operating-pack runs. Open Agents commit
`ef196076` adds `queue_telemetry_exports` with redacted metadata, workspace/run
binding, replay idempotency, and migration `0053_queue_telemetry_exports`.
Focused ingress tests (3/3), Biome, TypeScript, and a clean production build
passed; deployment `dpl_Brp3mzphTaS9R6y2rahr4f8JSzWg` applied the migration.

The post-deploy worker certifier passed 1/1 under the five-minute bounded
configuration. The fresh 64-concurrent run completed **62/64**, improving the
previous 61/64 result. Gateman classification: the repair persistence defect
is fixed and the lower-load path is green, but the absolute capacity gate is
still open because two high-concurrency runs missed initial convergence and
telemetry delivery pressure remains observable. No wallet, payment, customer,
or tax-agent state was touched.

## Telemetry concurrency experiment — 2026-07-12

An opt-in bounded concurrent sender (1–32) was added with a focused regression
test. The production experiment at budget 8 passed 32/32 but yielded mixed
64-way results (59/64 and 60/64), so Gateman does not treat it as a closure of
the capacity gate. Production was returned to the conservative single-sender
default in commit `d2c929de`; the post-deploy one-certifier worker proof passed
again. The option remains available for a separately admitted load test.

## Expo authenticated-environment simulator attempt — 2026-07-12

The iOS release bundle was rebuilt with the existing Supabase public URL/key and
the fixed Desk preview as `EXPO_PUBLIC_BACKEND_URL`; Metro embedded the bundle
and Xcode Release build completed with `BUILD SUCCEEDED`. The installed
`com.bufinance.bufi` simulator app launched and accepted a `bufi://` auth deep
link far enough to display the native “Open in BUFI?” confirmation. The local
Computer Use native pipe was unavailable, so the system confirmation could not
be pressed. This is stronger native configuration evidence, but it does not
close authenticated mobile workflow, approval/cancellation, push, or physical
device gates.

## Desk agent-wallet gateway integration — 2026-07-13

PR #553 commit `80158daac` was audited as the next non-tax implementation
slice. Desk's completion and audio gateways now inject a server-bound adapter
that resolves the workspace's `wallet_purpose='agent'` row and reads Circle
balances through `WalletService`; the model cannot select a wallet ID, chain
record, credential, or database identity. Decimal Circle balances are parsed
and converted to bounded six-decimal atomic units before the intelligence tool
contract sees them.

Writes are intentionally non-dispatching: transfer and x402 calls return an
explicit `approval_required` result and point to the existing HITL/multisig
boundary. Service discovery fails closed as unavailable until an authorized
x402 directory adapter is configured. The adapter, agent-wallet, and wallet
guard and gateway suites pass **25/25 (79 assertions)**; intelligence typecheck
and Desk pre-push hooks pass. The implementation commit's app typecheck passed;
the follow-up dependency-injection-only test refactor is covered by the Bun
suite.

Gateman classification: **PASS for actor binding, response validation,
exact-money conversion, and non-dispatching approval boundary; OPEN for real
service discovery, approved Circle executor/spend, and the overall 100% goal.**
