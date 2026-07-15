# AI invoice → durable Factura E workflow

BUFI's AI invoice composer can send its structured draft directly to
`POST /api/bufi/tax-invoice`. The endpoint accepts either the canonical
`TaxInvoiceDispatch` contract, `AiInvoiceArtifactDispatch`, or the persisted
invoice document returned by BUFI's `create_document(kind: "invoice")` tool.
Both AI shapes are normalized before starting the same durable workflow.

This integration does not make the model a tax authority:

- AI may propose customer, line-item and service-description fields.
- `exportContext` must come from confirmed workspace/tax-profile state and
  effective-dated rules. The model must not invent destination ARCA codes,
  export point of sale, consent or exchange-rate authority references.
- The adapter reconciles every line item, subtotal, tax, discount and total in
  integer minor units using exact decimal arithmetic.
- The server computes the artifact and source-event hashes. Callers cannot
  provide CAE, CUIT, Clave Fiscal, WSFEX credentials or authority state because
  the input is strict and rejects unknown fields.
- Starting a run is not approval. The Tax Automation Engine owns the frozen
  intent and its separate trusted user/accountant approval channels.
- Reclaim proves readiness or a CAE fact. It never authorizes the invoice.

## Chain from BUFI's AI invoice tool

The assistant creates the invoice document first, then sends the exact persisted
artifact to this ingress. No second model pass or client-side money remapping is
required:

Desk's authenticated `POST /api/chat/execute-write` approval path creates or
reuses the deterministic invoice draft and forwards that exact server-side
artifact with a five-minute grant scoped only to `tax.invoice.prepare`. The
Open Agents ingress rejects otherwise valid workspace grants without that
scope. The browser never receives the B2B ingress secret or signed grant.

```json
{
  "workspaceId": "11111111-1111-4111-8111-111111111111",
  "actorId": "agent:tax",
  "idempotencyKey": "tax-invoice:desk-document-1",
  "issuancePath": "reclaim_copilot",
  "ledgerInvoiceId": "33333333-3333-4333-8333-333333333333",
  "document": {
    "id": "desk-document-1",
    "kind": "invoice",
    "content": "{\"invoiceNumber\":\"INV-2026-001\",\"title\":\"July services\",\"customerName\":\"Foreign customer\",\"issueDate\":\"2026-07-11\",\"dueDate\":\"2026-08-10\",\"currency\":\"USD\",\"lineItems\":[{\"name\":\"Software services\",\"quantity\":1,\"price\":150000}],\"subtotal\":150000,\"total\":150000,\"status\":\"draft\"}"
  },
  "exportContext": {
    "destinationCountry": "US",
    "destinationCountryArcaCode": 200,
    "pointOfSale": 4,
    "paymentDate": "2026-07-11",
    "sameCurrencyPayment": true,
    "exchangeRate": null,
    "consentVersion": "tax-consent-v1",
    "unitCode": 7,
    "observedAt": "2026-07-11T12:00:00.000Z"
  }
}
```

`exportContext` is trusted workspace state, not model output. The AI-created JSON
is parsed with a strict invoice schema, reconciled in integer minor units, and
hashed server-side. Unknown fields such as CAE, CUIT, Clave Fiscal, or authority
status are rejected before a workflow can start.

`ledgerInvoiceId` is also trusted server state: it is the UUID of Desk's
canonical Invoice 2.0 `invoices` row. It is deliberately separate from
`document.id`/`artifact.documentId`, which identify the AI evidence artifact.
Open Agents binds settlement events only on `ledgerInvoiceId`; it never derives
that UUID from a document ID or model output.

## Request shape

```json
{
  "workspaceId": "11111111-1111-4111-8111-111111111111",
  "actorId": "agent:tax",
  "idempotencyKey": "tax-invoice:ai-document-1",
  "issuancePath": "reclaim_copilot",
  "ledgerInvoiceId": "33333333-3333-4333-8333-333333333333",
  "artifact": {
    "documentId": "ai-document-1",
    "invoiceNumber": "INV-2026-001",
    "customerSafeLabel": "Foreign customer",
    "issueDate": "2026-07-11",
    "dueDate": "2026-08-10",
    "currency": "USD",
    "lineItems": [
      {
        "name": "Software services used abroad",
        "quantityDecimal": "1.5",
        "unitPriceCents": 100000
      }
    ],
    "subtotalCents": 150000,
    "taxAmountCents": 0,
    "discountAmountCents": 0,
    "totalCents": 150000
  },
  "exportContext": {
    "destinationCountry": "US",
    "destinationCountryArcaCode": 200,
    "pointOfSale": 4,
    "paymentDate": "2026-07-11",
    "sameCurrencyPayment": true,
    "exchangeRate": null,
    "consentVersion": "tax-consent-v1",
    "unitCode": 7,
    "observedAt": "2026-07-11T12:00:00.000Z"
  }
}
```

Authenticate with `Authorization: Bearer
${OPEN_AGENTS_BUFI_INGRESS_SECRET}`. A first request returns `202`; an exact
replay returns the existing execution. Reusing the idempotency key for a
different normalized invoice returns `409`. If the durable workflow service is
temporarily unavailable before startup, an exact retry atomically reclaims and
starts the same execution and binding; callers must not mint another
idempotency key.

## Canonical settlement handoff

Settlement remains part of the existing invoice lifecycle; this integration
does not introduce a second “shared invoice-settlement” subsystem. Desk Invoice
2.0 owns invoice sending and ordinary, unfactored allocation/finality. Existing
payment rails supply payment evidence. fx-recibu and the standalone
chainlink-cre workflow own the factored-receivable lifecycle, CRE orchestration
and factoring. Payment Score consumes evidence as an underwriting input; it is
never settlement or tax authority. The Tax Automation workflow consumes the
resulting canonical verified settlement fact:

1. For the ordinary/unfactored path, Desk finalizes or reverses an invoice
   allocation and publishes the strict `InvoiceSettlementFinalizedV1` or
   `InvoiceSettlementReversedV1` event from its transactional outbox. Raw bank,
   wallet and provider identifiers remain in access-controlled evidence
   storage; the event carries hashes and an opaque evidence reference.
2. Desk's worker sends that event to `POST /api/bufi/tax-settlement` with the
   server ingress bearer token and a short-lived workspace grant scoped to
   `tax.invoice.settlement` for the tax-settlement service actor.
3. Open Agents validates the same exact-money, source/evidence and projection
   invariants as Desk, then persists the event in `tax_settlement_deliveries`
   before attempting Tax Engine delivery. `eventId` and the workspace replay
   key make retries deterministic.
4. `tax_invoice_bindings` connects the event's canonical Invoice 2.0 UUID to the
   already-running Factura E workflow and Tax Engine run. Artifact/document IDs
   are retained as evidence identity but never participate in this join. Events
   may arrive before or after the tax case: both the receiver and case binder
   backfill the other durable row, so neither ordering loses a settlement.
5. Open Agents projects the verified event into the Tax Engine's existing
   `tax_ar_factura_e_record_settlement` action. The mutation idempotency key is
   `invoice-settlement:<eventId>`; Open Agents records a trace without copying
   raw financial evidence.
6. Delivery acquisition uses a bounded processing lease and compare-and-set
   completion, so duplicate workers cannot regress a completed event. Finalized
   facts are processed before reversals; a reversal records its causal
   `reversesEventId` and is retried immediately when that finalized fact lands.
   The durable workflow hook then advances immediately. A daily wake remains
   only as a recovery fallback, and a reversal reopens the case as
   `settlement_attention_required`.

The Tax Engine then owns the tax-specific progression from verified settlement
through FX-ingress review and declaration/accountant review. “Export to
contador” remains an explicit downstream review and evidence handoff; it is not
the mechanism that discovers or settles the invoice.

## Honest one-click UI contract

The UI may generate and refine the draft without a material-action approval.
Once readiness and deterministic rules produce a frozen intent, show one
approval action for that exact intent hash. Path B then hands the approved
fields to the user's ARCA session and Reclaim captures the result. Never render
“issued”, “ARCA authorized” or “declared” before the corresponding verified
workflow checkpoint exists.
