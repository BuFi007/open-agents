# AI invoice → durable Factura E workflow

BUFI's AI invoice composer can send its structured draft directly to
`POST /api/bufi/tax-invoice`. The endpoint accepts either the canonical
`TaxInvoiceDispatch` contract, `AiInvoiceArtifactDispatch`, or the persisted
invoice document returned by BUFI's `create_document(kind: "invoice")` tool.
Both AI shapes are normalized before starting the same durable workflow.

This integration does not make the model a tax authority:

The durable run is orchestrated by the BUFI Tax Agent specialist DAG. Evidence,
jurisdiction and accounting-context specialists fan out in parallel, join on a
hash-bound economic event, and then call the external engine. The specialists
are read-only; the engine remains the sole deterministic tax authority and the
trusted approval channel remains outside the agent runtime. See
[`tax-agent-workflow.md`](./tax-agent-workflow.md).

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

## Request shape

```json
{
  "workspaceId": "11111111-1111-4111-8111-111111111111",
  "actorId": "agent:tax",
  "idempotencyKey": "tax-invoice:ai-document-1",
  "issuancePath": "reclaim_copilot",
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
different normalized invoice returns `409`.

## Honest one-click UI contract

The UI may generate and refine the draft without a material-action approval.
Once readiness and deterministic rules produce a frozen intent, show one
approval action for that exact intent hash. Path B then hands the approved
fields to the user's ARCA session and Reclaim captures the result. Never render
“issued”, “ARCA authorized” or “declared” before the corresponding verified
workflow checkpoint exists.
