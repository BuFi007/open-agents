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

## Verification

The non-tax package sweep is green:

```text
151 pass
20 skip (opt-in live provider/device/hosted-resource cases)
0 fail
470 expect() calls
```

The monorepo typecheck is green across 19 targets. Focused checks also pass:

- knowledge-worker config and repair scheduler: 4 tests
- Circle broker full-registry forwarding: 4 tests
- connector provider identity envelope: 4 tests
- agentic workspaces and horizontal ERP contract E2E: 2 tests

The corrected live harness report was generated with report hash
`sha256:ca43e116b57ff7d261b2aa0968725114c0ef278d213d8b03c448f94aee34271b`.
Open Agents passed its target-specific matrix; Hermes and Codex handshakes
passed; Claude Code remained blocked by account credit; Computer Use remained
blocked by macOS Screen Recording/TCC. Circle wallet read-only and bufi-hyper
tools/list passed. The configured live BullMQ Redis run still fails with
`Connection is closed`; its certification teardown is now bounded so an
unavailable provider does not leave the test process hanging for a minute.
The current production alias was redeployed as
`dpl_J9i8U3EE8LTJVpQvMT21N1WFuYMK`; an authenticated workspace-grant GET to
`/api/bufi/operations` returned 200 and exposed the `agent_wallet` pack with
17 tool grants and three workflows. The production broker secret was
provisioned as a sensitive Vercel environment variable; its value is not
stored in this repository or audit output.

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
   latency, noisy-neighbor, and kill/restart saturation evidence;
3. larger hybrid-recall and freshness-load evidence plus a deployed repair
   cycle;
4. authenticated Desk browser launch/approve/reject/cancel/traces/citations;
5. Expo/Cleo physical-device workflow and approval evidence;
6. a funded Claude account and macOS Accessibility/Screen Recording approval;
7. one connected internal operating-week report with three workflows, five
   KPIs, trace links, and zero unexpected spend;
8. authenticated Desk browser launch/approve/reject/cancel/traces/citations
   and a current hosted citation path beyond the authenticated catalog GET.

These are evidence/deployment gates, not reasons to weaken the code contract.
