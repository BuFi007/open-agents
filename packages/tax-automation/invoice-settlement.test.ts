import { describe, expect, test } from "bun:test";

import {
  InvoiceSettlementEventV1Schema,
  settlementReferenceHashForEvent,
  taxSettlementCommandFor,
} from "./invoice-settlement";

const event = {
  schemaVersion: 1 as const,
  eventType: "InvoiceSettlementFinalizedV1" as const,
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
  allocationBasis: "net" as const,
  network: "base",
  fx: null,
  source: {
    kind: "circle_transfer" as const,
    provider: "circle",
    identityHash: "b".repeat(64),
    revision: 1,
  },
  evidence: {
    status: "verified" as const,
    method: "provider_webhook" as const,
    hashAlgorithm: "sha256" as const,
    evidenceRef: "10000000-0000-4000-8000-000000000006",
    evidenceHash: "c".repeat(64),
    verifiedAt: "2026-07-15T14:00:00.000Z",
  },
  recordedAt: "2026-07-15T14:00:01.000Z",
  finalizedAt: "2026-07-15T13:59:59.000Z",
  allocationAmount: "100.00",
  projection: {
    version: 1,
    state: "paid" as const,
    invoiceTotal: "100.00",
    settledTotal: "100.00",
    outstandingAmount: "0",
  },
};

describe("Invoice 2.0 settlement adapter", () => {
  test("maps exact finality into the existing Tax Engine command", () => {
    expect(InvoiceSettlementEventV1Schema.parse(event)).toEqual(event);
    expect(taxSettlementCommandFor(event)).toEqual({
      settlementReferenceHash: settlementReferenceHashForEvent(event.eventId),
      asset: "USDC",
      network: "base",
      amount: { decimal: "100.00", currency: "USDC" },
      observedAt: event.finalizedAt,
      finalityState: "final",
      fees: { decimal: "0.50", currency: "USDC" },
      reversesSettlementReferenceHash: null,
      evidence: {
        version: "factura-e-settlement-evidence-v1",
        source: event.source,
        sourceMoney: event.sourceMoney,
        sourceEquivalentAmount: "100.00",
        allocationBasis: "net",
        fx: null,
        verification: {
          method: "provider_webhook",
          evidenceHash: event.evidence.evidenceHash,
          verifiedAt: event.evidence.verifiedAt,
        },
      },
    });
  });

  test("does not duplicate a provider fee across split allocations", () => {
    const split = {
      ...event,
      allocationAmount: "40.00",
      sourceEquivalentAmount: "40.00",
      projection: {
        ...event.projection,
        state: "partially_paid" as const,
        invoiceTotal: "100.00",
        settledTotal: "40.00",
        outstandingAmount: "60.00",
      },
    };
    expect(taxSettlementCommandFor(split).fees).toBeNull();
  });

  test("maps a causal reversal to the original event reference", () => {
    const {
      finalizedAt: finalizedAtFromFinalEvent,
      allocationAmount: allocationAmountFromFinalEvent,
      ...eventBase
    } = event;
    void finalizedAtFromFinalEvent;
    void allocationAmountFromFinalEvent;
    const reversed = {
      ...eventBase,
      eventType: "InvoiceSettlementReversedV1" as const,
      eventId: "10000000-0000-4000-8000-000000000007",
      source: {
        ...event.source,
        kind: "provider_reversal" as const,
        revision: 2,
      },
      reversedAt: "2026-07-15T15:00:00.000Z",
      reversesEventId: event.eventId,
      reversedAmount: "100.00",
      reason: "provider_reversed" as const,
      projection: {
        ...event.projection,
        version: 2,
        state: "unpaid" as const,
        settledTotal: "0",
        outstandingAmount: "100.00",
      },
    };
    const command = taxSettlementCommandFor(reversed);
    expect(command.finalityState).toBe("reversed");
    expect(command.fees).toBeNull();
    expect(command.reversesSettlementReferenceHash).toBe(
      settlementReferenceHashForEvent(event.eventId),
    );
    expect(command.evidence.source).toMatchObject({
      kind: "provider_reversal",
      revision: 2,
    });
    expect(JSON.stringify(command.evidence)).not.toContain("evidenceRef");
  });

  test("rejects numbers, missing FX, and unknown raw provider fields", () => {
    expect(
      InvoiceSettlementEventV1Schema.safeParse({
        ...event,
        allocationAmount: 100,
      }).success,
    ).toBe(false);
    expect(
      InvoiceSettlementEventV1Schema.safeParse({
        ...event,
        allocationAmount: "1e2",
      }).success,
    ).toBe(false);
    expect(
      InvoiceSettlementEventV1Schema.safeParse({
        ...event,
        currency: "ARS",
      }).success,
    ).toBe(false);
    expect(
      InvoiceSettlementEventV1Schema.safeParse({
        ...event,
        source: { ...event.source, rawTransactionId: "secret" },
      }).success,
    ).toBe(false);
  });

  test("keeps exact arithmetic beyond Decimal.js default precision", () => {
    const exactLargeAmount = "123456789012345678901.01";
    const largeEvent = {
      ...event,
      sourceMoney: {
        currency: "USDC",
        grossAmount: "123456789012345678901.02",
        feeAmount: "0.01",
        netAmount: exactLargeAmount,
      },
      sourceEquivalentAmount: exactLargeAmount,
      allocationAmount: exactLargeAmount,
      projection: {
        ...event.projection,
        invoiceTotal: exactLargeAmount,
        settledTotal: exactLargeAmount,
        outstandingAmount: "0",
      },
    };
    expect(InvoiceSettlementEventV1Schema.safeParse(largeEvent).success).toBe(
      true,
    );
    expect(
      InvoiceSettlementEventV1Schema.safeParse({
        ...largeEvent,
        sourceMoney: {
          ...largeEvent.sourceMoney,
          grossAmount: "123456789012345678901.03",
        },
      }).success,
    ).toBe(false);
  });

  test("rejects oversized exact-decimal strings before BigInt parsing", () => {
    expect(
      InvoiceSettlementEventV1Schema.safeParse({
        ...event,
        allocationAmount: "1".repeat(81),
      }).success,
    ).toBe(false);
  });

  test("rejects settlement facts that the Desk contract rejects", () => {
    expect(
      InvoiceSettlementEventV1Schema.safeParse({
        ...event,
        source: { ...event.source, kind: "provider_reversal" },
      }).success,
    ).toBe(false);
    expect(
      InvoiceSettlementEventV1Schema.safeParse({
        ...event,
        evidence: { ...event.evidence, method: "onchain_receipt" },
      }).success,
    ).toBe(false);
    expect(
      InvoiceSettlementEventV1Schema.safeParse({
        ...event,
        fx: {
          rate: "1",
          sourceCurrency: "USDC",
          allocationCurrency: "USDC",
          evidenceRef: "10000000-0000-4000-8000-000000000008",
          evidenceHash: "d".repeat(64),
          verifiedAt: "2026-07-15T14:00:00.000Z",
        },
      }).success,
    ).toBe(false);
    expect(
      InvoiceSettlementEventV1Schema.safeParse({
        ...event,
        allocationAmount: "99.00",
      }).success,
    ).toBe(false);
    expect(
      InvoiceSettlementEventV1Schema.safeParse({
        ...event,
        projection: {
          ...event.projection,
          state: "unpaid",
          settledTotal: "0",
          outstandingAmount: "100.00",
        },
      }).success,
    ).toBe(false);
    expect(
      InvoiceSettlementEventV1Schema.safeParse({
        ...event,
        projection: {
          ...event.projection,
          state: "partially_paid",
          settledTotal: "99.00",
          outstandingAmount: "1.00",
        },
      }).success,
    ).toBe(false);

    const { finalizedAt, allocationAmount, ...eventBase } = event;
    void finalizedAt;
    void allocationAmount;
    const selfReversal = {
      ...eventBase,
      eventType: "InvoiceSettlementReversedV1" as const,
      eventId: "10000000-0000-4000-8000-000000000009",
      source: { ...event.source, kind: "provider_reversal" as const },
      reversedAt: "2026-07-15T15:00:00.000Z",
      reversesEventId: "10000000-0000-4000-8000-000000000009",
      reversedAmount: "100.00",
      reason: "provider_reversed" as const,
      projection: {
        ...event.projection,
        version: 2,
        state: "unpaid" as const,
        settledTotal: "0",
        outstandingAmount: "100.00",
      },
    };
    expect(InvoiceSettlementEventV1Schema.safeParse(selfReversal).success).toBe(
      false,
    );
    expect(
      InvoiceSettlementEventV1Schema.safeParse({
        ...selfReversal,
        eventId: "10000000-0000-4000-8000-000000000010",
        reversesEventId: event.eventId,
        source: event.source,
      }).success,
    ).toBe(false);
  });
});
