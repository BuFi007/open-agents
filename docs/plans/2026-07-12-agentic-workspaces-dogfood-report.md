# Agentic Workspaces dogfood report — 2026-07-12

This is a bounded internal dogfood window for the non-tax Agentic Workspaces
runtime. It is not a substitute for the required operating-week report and it
does not claim 100% bucket parity.

## Scope

- Deployment: `dpl_HAxSnCsvYDvrSMBGSTdCdBCKKLY9`
- Alias: `https://open-agents-bay.vercel.app`
- Pack: `agent_wallet`
- Harness: `pi`
- Grant mode: disposable signed read-only/spend grants
- Money movement: none; no wallet was created, funded, deployed, or spent

## Workflow window

| Run | Workflow | Terminal result | Safety result | Trace evidence |
| --- | --- | --- | --- | --- |
| 1 | `agent_wallet_service_discovery` | `completed` | read-only Circle discovery; disposable workspace had no executor | `workflow.started`, `artifact.emitted`, `agent.started`, non-zero `tool.called`, `agent.completed`, `run.completed` |
| 2 | `agent_wallet_payment` | `rejected` | explicit approval rejection; no payment or wallet mutation | `approval.requested`, `approval.rejected` |
| 3 | `agent_wallet_payment` | `cancelled` | cancellation at approval boundary; no payment or wallet mutation | `run.cancelled` |

The first run's tool trace included Circle service-discovery input/output and
the expected executor-gated result. The two high-risk runs stopped before any
spend-capable broker call.

## KPIs

| KPI | Result | Interpretation |
| --- | --- | --- |
| Durable terminal completion | 3/3 (100%) | Every submitted workflow reached an intentional terminal state. |
| Approval boundary enforcement | 2/2 (100%) | Both spend workflows stopped at the human gate; neither crossed into payment. |
| Unexpected spend | `$0` / 0 mutations | No Circle wallet or payment side effect occurred. |
| Lifecycle trace coverage | 3/3 runs | Each run emitted terminal lifecycle evidence; the read-only run also emitted tool-call evidence. |
| Disposable-fixture cleanup | 3/3 runs | Temporary workspace/run/bridge fixtures were removed after each probe. |

## Fresh authenticated browser-to-harness probe — 2026-07-12 16:25 UTC

The stale cancelled Desk previews were replaced with a READY preview from the
Expo remediation branch:

- Desk deployment: `dpl_DSXFzhm4V9ZLpswiaFMHjh4icTSP`
- Preview: `https://desk-v1-a68ra6c6g-bu-finance-007.vercel.app`
- Auth callback: HTTP `200`, final route `/teams/setup/wallets`
- Authenticated Desk workspace grant: HTTP `200`
- Open Agents start: HTTP `202`
- Open Agents terminal state: `completed`
- Trace sequence: `workflow.started → artifact.emitted → agent.started →
  tool.called ×4 → agent.completed → run.completed → notification.skipped`
- Cleanup verification: `operating_pack_runs=0`, bridge user rows `=0`
- Redacted evidence summary hash:
  `sha256:54ce676fd7e5dd1ec3b565ee6734a6a78e962b98645117f681a4f9433a719ee9`

This closes the current authenticated Desk grant and browser-to-harness
read-only workflow boundary. It still does not prove wallet executor
provisioning, approved spend, authorized connector accounts, saturation, or a
week-long operating report.

## Desk broker admission-error revalidation — 2026-07-12 16:46 UTC

Desk PR #546 advanced to commit `c0d0a1fb`. The internal broker now preserves
structured bufi-hyper admission failures (`agent_wallet_workspace_required`)
instead of collapsing them to a generic 422. The focused broker contract suite
passes 8 tests / 24 assertions, including the degraded-state response. This is
an important safety boundary: a missing isolated wallet executor is visible to
the user and cannot be mistaken for a successful wallet operation.

The PR's Vercel app checks pass. GitHub Validate and Claude review currently
fail before any workflow steps start (empty job step lists); this is recorded as
CI/runner infrastructure, not treated as a product pass. The hosted disposable
user still has no active wallet workspace/executor, so no wallet mutation or
spend was attempted.

## Evidence boundaries

This report proves the hosted durable workflow, non-zero read-only tool-call,
approval rejection, cancellation, trace, and cleanup boundaries. It does not
prove:

1. isolated wallet executor provisioning or an approved wallet mutation/spend;
2. authorized Pipedream, Magic Inbox, QuickBooks, Xero, Conta Azul, or
   Contabilium sandbox events;
3. production saturation/noisy-neighbor limits or a week-long operating report;
4. a fully authenticated Desk browser launch/approve/cancel/citation journey;
5. physical Expo/Cleo device evidence, Claude credits, or macOS Computer Use
   permissions.

The authoritative non-tax score therefore remains the conservative **82.7%
strict baseline** (with **85.6%** retained only as a post-change estimate), not
100%.

## Fresh Desk command-center preview — 2026-07-12 17:30 UTC

The Turbo build environment fix from Desk commit `cb2347408` produced a READY
preview at `https://desk-v1-6jkto3ggb-bu-finance-007.vercel.app` and restored the
`/agent-workspaces` route. An authenticated Playwright probe rendered the BUFI
command center, pack composer, harness selector, launch controls, workflow
timeline, trace/evidence panels, specialist roster, ownership map, and
approval/cancellation controls. No wallet spend or external mutation was
performed.

The same probe found the hosted Operations API returning `401 Unauthorized`
while unrelated authenticated Desk APIs returned `200`. Therefore the
browser-render gate passes, but hosted launch/trace/approval/citation E2E is
still open until preview auth/session handling is corrected. This is recorded as
a blocker rather than a false pass; the strict score remains below 100%.
