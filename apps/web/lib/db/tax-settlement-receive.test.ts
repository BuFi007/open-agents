import { describe, expect, test } from "bun:test";
import type { InvoiceSettlementEventV1 } from "@open-agents/tax-automation";
import type { TaxInvoiceBinding, TaxSettlementDelivery } from "./schema";
import { receiveTaxSettlementDeliveryWithStore } from "./tax-settlement-receive";

const event: InvoiceSettlementEventV1 = {
  schemaVersion: 1,
  eventType: "InvoiceSettlementFinalizedV1",
  eventId: "10000000-0000-4000-8000-000000000001",
  teamId: "10000000-0000-4000-8000-000000000002",
  invoiceId: "10000000-0000-4000-8000-000000000003",
  billId: null,
  settlementId: "10000000-0000-4000-8000-000000000004",
  allocationId: "10000000-0000-4000-8000-000000000005",
  allocationRevision: 1,
  replayKey: "a".repeat(64),
  traceId: null,
  currency: "USDC",
  sourceMoney: {
    currency: "USDC",
    grossAmount: "100.50",
    feeAmount: "0.50",
    netAmount: "100.00",
  },
  sourceEquivalentAmount: "100.00",
  allocationBasis: "net",
  network: "base",
  fx: null,
  source: {
    kind: "circle_transfer",
    provider: "circle",
    identityHash: "b".repeat(64),
    revision: 1,
  },
  evidence: {
    status: "verified",
    method: "provider_webhook",
    hashAlgorithm: "sha256",
    evidenceRef: "10000000-0000-4000-8000-000000000006",
    evidenceHash: "c".repeat(64),
    verifiedAt: "2026-07-15T14:00:00.000Z",
  },
  recordedAt: "2026-07-15T14:00:01.000Z",
  finalizedAt: "2026-07-15T13:59:59.000Z",
  allocationAmount: "100.00",
  projection: {
    version: 1,
    state: "paid",
    invoiceTotal: "100.00",
    settledTotal: "100.00",
    outstandingAmount: "0",
  },
};

describe("receiveTaxSettlementDeliveryWithStore", () => {
  test("backfills a binding committed between its first lookup and insert", async () => {
    const now = new Date("2026-07-15T14:00:00.000Z");
    const binding: TaxInvoiceBinding = {
      workspaceId: event.teamId,
      ledgerInvoiceId: event.invoiceId,
      operatingPackRunId: "tax_execution_1",
      taxRunId: "20000000-0000-4000-8000-000000000001",
      taxIdempotencyKey: "tax-invoice:invoice-1",
      createdAt: now,
      updatedAt: now,
    };
    const order: string[] = [];
    let bindingReads = 0;
    let persisted: TaxSettlementDelivery | undefined;

    const result = await receiveTaxSettlementDeliveryWithStore(
      { event, requestHash: "d".repeat(64) },
      {
        findBinding: async () => {
          bindingReads += 1;
          const found = bindingReads > 1;
          order.push(found ? "binding:hit" : "binding:miss");
          return found ? binding : undefined;
        },
        insertDelivery: async (delivery) => {
          order.push("delivery:insert");
          persisted = {
            ...delivery,
            attempts: 0,
            processingToken: null,
            processingStartedAt: null,
            lastErrorCode: null,
            completedAt: null,
            createdAt: now,
            updatedAt: now,
          };
          return persisted;
        },
        findDelivery: async () => persisted,
        backfillBinding: async ({ binding: resolved }) => {
          order.push("delivery:backfill");
          persisted = persisted && {
            ...persisted,
            operatingPackRunId: resolved.operatingPackRunId,
            taxRunId: resolved.taxRunId,
          };
          return persisted;
        },
      },
    );

    expect(order).toEqual([
      "binding:miss",
      "delivery:insert",
      "binding:hit",
      "delivery:backfill",
    ]);
    expect(result.binding).toEqual(binding);
    expect(result.delivery.operatingPackRunId).toBe(binding.operatingPackRunId);
    expect(result.delivery.taxRunId).toBe(binding.taxRunId);
  });

  test("fails closed instead of rebinding an existing delivery", async () => {
    const now = new Date("2026-07-15T14:00:00.000Z");
    const binding: TaxInvoiceBinding = {
      workspaceId: event.teamId,
      ledgerInvoiceId: event.invoiceId,
      operatingPackRunId: "tax_execution_current",
      taxRunId: "20000000-0000-4000-8000-000000000001",
      taxIdempotencyKey: "tax-invoice:invoice-1",
      createdAt: now,
      updatedAt: now,
    };
    const delivery: TaxSettlementDelivery = {
      eventId: event.eventId,
      workspaceId: event.teamId,
      ledgerInvoiceId: event.invoiceId,
      operatingPackRunId: "tax_execution_other",
      taxRunId: "20000000-0000-4000-8000-000000000099",
      eventType: event.eventType,
      reversesEventId: null,
      replayKey: event.replayKey,
      requestHash: "d".repeat(64),
      payload: event,
      status: "waiting_for_case",
      attempts: 0,
      processingToken: null,
      processingStartedAt: null,
      lastErrorCode: null,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    let backfilled = false;

    await expect(
      receiveTaxSettlementDeliveryWithStore(
        { event, requestHash: delivery.requestHash },
        {
          findBinding: async () => binding,
          insertDelivery: async () => undefined,
          findDelivery: async () => delivery,
          backfillBinding: async () => {
            backfilled = true;
            return delivery;
          },
        },
      ),
    ).rejects.toThrow("another tax case");
    expect(backfilled).toBe(false);
  });
});
