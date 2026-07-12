# BUFI Tax Agent orchestration

The Tax Automation Engine is the authority-backed backend. Open Agents owns
the specialist workflow that gathers context, explains evidence and pauses at
human gates. It never becomes an ARCA client, stores credentials, or writes an
ERP directly.

```text
tax_evidence ───────┐
tax_jurisdiction ───┼─ join ── tax_engine_prepare ── tax_engine_checkpoint
tax_accounting ─────┘                                      │
                                                          ▼
                                           trusted tax.invoice.review
                                                          │
                                                          ▼
                                               tax_engine_resume
```

`@open-agents/tax-agent` implements this graph with the durable workflow kernel
and is consumed by Desk's Vercel Workflow. The evidence specialist accepts
metadata-only references from the canonical graph and accounting connectors
(QuickBooks, Xero, Conta Azul, Contabilium, banks, Stripe, wallets, Magic
Inbox, enrichment and analytics). Enrichment, analytics and graph matches are
explicitly marked as candidate signals; only accepted source evidence can
unlock the engine's deterministic proposal.

Every evidence reference carries its period, freshness (`observedAt`), source,
freshness state, consent version, confidence, accountant-review status and hash.
The join is event-scoped and deterministic
so an invoice cannot be summed twice when the same economic event appears in
an ERP, bank and document source. Missing accounting or settlement links are
reported to the UI as evidence gaps.

The jurisdiction and accounting-context conclusions carry the same source,
period, freshness, confidence, consent scope, evidence hash and review-status
envelope; they are context assertions, never tax authority truth.

The engine remains the only component allowed to validate a Factura E intent,
start Reclaim, submit/recover WSFEX, interpret an authority receipt, or produce
an accounting attestation packet. The workflow's `tax.invoice.review` node is
only an evidence/next-action acknowledgment. It is deliberately distinct from
the engine's trusted user/accountant approval endpoints; an Open Agents run can
be paused and resumed without replaying the completed specialists. Tax
credentials, Clave Fiscal, CUIT/TIN values, private keys and approval tokens
are never workflow input or trace data.

Desk and Cleo should render the persisted workflow status and native trace
events, including the evidence root, source counts, missing links, intent hash,
next action and approval owner. They must not render “issued”, “ARCA
authorized”, “declared” or “accounting ready” until the corresponding engine
checkpoint is present.
