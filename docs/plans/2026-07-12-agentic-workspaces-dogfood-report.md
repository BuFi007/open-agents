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
