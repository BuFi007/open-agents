import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { NextRequest } from "next/server";

const serviceActor = "00000000-0000-4000-8000-000000000309";
let grantValid = true;
let grantSubject = serviceActor;
let grantScopes = ["tax.invoice.settlement"];
let binding: { operatingPackRunId: string; taxRunId: string } | undefined;
let deliveryStatus: "waiting_for_case" | "processing" | "completed" =
  "waiting_for_case";
let created = true;
let delivered = 0;
let dependentsDelivered = 0;
let resumed = 0;
let deliveryError: Error | null = null;
let receiveError: Error | null = null;

class MockTaxError extends Error {
  constructor(
    readonly code: string,
    readonly retryable = false,
  ) {
    super(code);
    this.name = "MockTaxError";
  }
}

mock.module("@/lib/operating-packs/desk-grant", () => ({
  verifyDeskWorkspaceGrant: () =>
    grantValid ? { subject: grantSubject, scopes: grantScopes } : null,
}));

mock.module("@/lib/db/tax-settlements", () => ({
  TaxSettlementDeliveryConflictError: MockTaxError,
  bindTaxInvoiceRun: async (input: Record<string, unknown>) => input,
  receiveTaxSettlementDelivery: async () => {
    if (receiveError) throw receiveError;
    return {
      delivery: { status: deliveryStatus },
      binding,
      created,
    };
  },
}));

mock.module("@/lib/operating-packs/tax-settlement-delivery", () => ({
  TaxSettlementDeliveryError: MockTaxError,
  deliverTaxSettlement: async () => {
    delivered += 1;
    if (deliveryError) throw deliveryError;
    if (deliveryStatus === "processing") return { status: "processing" };
    return { status: "completed", replayed: false, taxRevision: 7 };
  },
  deliverTaxSettlementDependents: async () => {
    dependentsDelivered += 1;
    return 1;
  },
}));

mock.module("@/lib/operating-packs/tax-settlement-hook", () => ({
  TAX_SETTLEMENT_SERVICE_ACTOR_ID: serviceActor,
  getTaxSettlementHookToken: () => "tax_settlement_hook",
}));

mock.module("workflow/api", () => ({
  resumeHook: async () => {
    resumed += 1;
  },
}));

const { POST } = await import("./route");

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

const secret = "shared-ingress-secret-at-least-thirty-two";

function request(body: unknown, authorized = true): NextRequest {
  return new Request("https://open-agents.test/api/bufi/tax-settlement", {
    method: "POST",
    headers: {
      authorization: authorized ? `Bearer ${secret}` : "Bearer invalid",
      "content-type": "application/json",
      "x-bufi-workspace-grant": "signed-workspace-grant",
    },
    body: JSON.stringify(body),
  }) as NextRequest;
}

beforeEach(() => {
  process.env.OPEN_AGENTS_BUFI_INGRESS_SECRET = secret;
  grantValid = true;
  grantSubject = serviceActor;
  grantScopes = ["tax.invoice.settlement"];
  binding = undefined;
  deliveryStatus = "waiting_for_case";
  created = true;
  delivered = 0;
  dependentsDelivered = 0;
  resumed = 0;
  deliveryError = null;
  receiveError = null;
});

describe("BUFI invoice settlement Tax Automation ingress", () => {
  test("durably accepts a verified event before its tax case exists", async () => {
    const response = await POST(request(event));
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      eventId: event.eventId,
      status: "waiting_for_tax_case",
    });
    expect(delivered).toBe(0);
  });

  test("delivers a bound event and wakes the existing durable workflow", async () => {
    binding = {
      operatingPackRunId: "tax_execution_1",
      taxRunId: "20000000-0000-4000-8000-000000000001",
    };
    const response = await POST(request(event));
    expect(response.status).toBe(200);
    expect(delivered).toBe(1);
    expect(dependentsDelivered).toBe(1);
    expect(resumed).toBe(1);
  });

  test("returns a completed replay without invoking Tax Engine again", async () => {
    deliveryStatus = "completed";
    const response = await POST(request(event));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ replayed: true });
    expect(delivered).toBe(0);
  });

  test("retries causal dependents on a completed finalized replay", async () => {
    deliveryStatus = "completed";
    binding = {
      operatingPackRunId: "tax_execution_1",
      taxRunId: "20000000-0000-4000-8000-000000000001",
    };
    const response = await POST(request(event));
    expect(response.status).toBe(200);
    expect(delivered).toBe(0);
    expect(dependentsDelivered).toBe(1);
    expect(resumed).toBe(1);
  });

  test("returns accepted while another delivery owns the processing lease", async () => {
    deliveryStatus = "processing";
    binding = {
      operatingPackRunId: "tax_execution_1",
      taxRunId: "20000000-0000-4000-8000-000000000001",
    };
    const response = await POST(request(event));
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ status: "processing" });
    expect(delivered).toBe(1);
  });

  test("returns 409 only for deterministic receive conflicts", async () => {
    receiveError = new MockTaxError("conflict");
    expect((await POST(request(event))).status).toBe(409);
    receiveError = new Error("database unavailable");
    const unavailable = await POST(request(event));
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toMatchObject({
      error: "TAX_SETTLEMENT_PERSISTENCE_UNAVAILABLE",
    });
  });

  test("fails closed for invalid ingress and settlement grants", async () => {
    expect((await POST(request(event, false))).status).toBe(401);
    grantScopes = ["tax.invoice.prepare"];
    expect((await POST(request(event))).status).toBe(403);
    expect(delivered).toBe(0);
  });

  test("rejects settlement facts that Desk's canonical contract rejects", async () => {
    expect(
      (
        await POST(
          request({
            ...event,
            evidence: { ...event.evidence, method: "onchain_receipt" },
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await POST(
          request({
            ...event,
            allocationAmount: "99.00",
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await POST(
          request({
            ...event,
            projection: {
              ...event.projection,
              state: "unpaid",
              settledTotal: "0",
              outstandingAmount: "100.00",
            },
          }),
        )
      ).status,
    ).toBe(400);
    expect(delivered).toBe(0);
  });

  test("separates retryable upstream failures from permanent contract errors", async () => {
    binding = {
      operatingPackRunId: "tax_execution_1",
      taxRunId: "20000000-0000-4000-8000-000000000001",
    };
    deliveryError = new MockTaxError(
      "TAX_AUTOMATION_UPSTREAM_UNAVAILABLE",
      true,
    );
    expect((await POST(request(event))).status).toBe(503);
    deliveryError = new MockTaxError("SETTLEMENT_CURRENCY_MISMATCH", false);
    expect((await POST(request(event))).status).toBe(422);
  });
});
