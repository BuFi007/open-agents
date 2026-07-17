import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { NextRequest } from "next/server";

let grantValid = true;
let grantSubject = "22222222-2222-4222-8222-222222222222";
let grantScopes = ["tax.invoice.prepare"];
let started = 0;
let startFailuresRemaining = 0;
let createdUserId: string | undefined;
let runUserId: string | undefined;
let bindingInput: Record<string, unknown> | undefined;
let storedRun: Record<string, unknown> | undefined;

mock.module("@/lib/operating-packs/desk-grant", () => ({
  verifyDeskWorkspaceGrant: () =>
    grantValid ? { subject: grantSubject, scopes: grantScopes } : null,
}));

mock.module("@/lib/operating-packs/desk-bridge-user", () => ({
  ensureDeskBridgeUser: async (subject: string) => `desk_${subject}`,
  deskBridgeUserId: (subject: string) => `desk_${subject}`,
}));

mock.module("@/lib/db/operating-pack-runs", () => ({
  getOperatingPackRun: async () => storedRun ?? null,
  getOperatingPackRunByIdempotency: async () => storedRun ?? null,
  createOperatingPackRun: async (input: Record<string, unknown>) => {
    runUserId = String(input.userId);
    storedRun = {
      ...input,
      workflowRunId: null,
      errorCode: null,
      result: null,
    };
    return { created: true, run: storedRun };
  },
  claimOperatingPackWorkflowRestart: async () => {
    if (
      storedRun?.status !== "failed" ||
      storedRun.errorCode !== "WORKFLOW_START_FAILED" ||
      storedRun.workflowRunId !== null
    )
      return undefined;
    storedRun = {
      ...storedRun,
      status: "pending",
      errorCode: null,
    };
    return storedRun;
  },
  updateOperatingPackRun: async (
    _runId: string,
    input: Record<string, unknown>,
  ) => {
    storedRun = storedRun && { ...storedRun, ...input };
  },
}));

mock.module("@/lib/db/tax-settlements", () => ({
  TaxSettlementDeliveryConflictError: class extends Error {},
  bindTaxInvoiceRun: async (input: Record<string, unknown>) => {
    bindingInput = input;
    return input;
  },
  receiveTaxSettlementDelivery: async () => ({
    delivery: { status: "waiting_for_case" },
    binding: undefined,
    created: true,
  }),
}));

mock.module("@/lib/db/sessions", () => ({
  createSessionWithInitialChat: async (input: {
    session: { userId: string };
  }) => {
    createdUserId = input.session.userId;
  },
}));

mock.module("@/app/workflows/tax-invoice", () => ({
  runTaxInvoiceWorkflow: async () => undefined,
}));

mock.module("workflow/api", () => ({
  start: async () => {
    started += 1;
    if (startFailuresRemaining > 0) {
      startFailuresRemaining -= 1;
      throw new Error("workflow unavailable");
    }
    return { runId: "wfr_tax_1" };
  },
  getRun: () => ({ status: Promise.resolve("running") }),
  resumeHook: async () => undefined,
}));

const { POST } = await import("./route");
const { GET: GET_STATUS } = await import("./[executionId]/route");

const secret = "shared-ingress-secret-at-least-sixteen";
const workspaceGrant = "signed-workspace-grant".padEnd(100, "x");
const workspaceId = "11111111-1111-4111-8111-111111111111";

const dispatch = {
  workspaceId,
  actorId: grantSubject,
  idempotencyKey: "tax-invoice:33333333-3333-4333-8333-333333333333",
  issuancePath: "reclaim_copilot" as const,
  ledgerInvoiceId: "55555555-5555-4555-8555-555555555555",
  artifact: {
    documentId: "33333333-3333-4333-8333-333333333333",
    invoiceNumber: "INV-2026-001",
    customerSafeLabel: "Foreign customer",
    issueDate: "2026-07-11",
    dueDate: "2026-08-10",
    currency: "USD",
    lineItems: [
      {
        name: "Software services used abroad",
        quantityDecimal: "1.5",
        unitPriceCents: 100_000,
      },
    ],
    subtotalCents: 150_000,
    taxAmountCents: 0,
    discountAmountCents: 0,
    totalCents: 150_000,
  },
  exportContext: {
    destinationCountry: "US",
    destinationCountryArcaCode: 200,
    pointOfSale: 4,
    paymentDate: "2026-07-11",
    sameCurrencyPayment: true,
    exchangeRate: null,
    consentVersion: "tax-consent-v1",
    unitCode: 7,
    observedAt: "2026-07-11T12:00:00.000Z",
  },
};

function request(body: unknown, grant = workspaceGrant): NextRequest {
  return new Request("https://open-agents.test/api/bufi/tax-invoice", {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
      "x-bufi-workspace-grant": grant,
    },
    body: JSON.stringify(body),
  }) as NextRequest;
}

beforeEach(() => {
  process.env.OPEN_AGENTS_BUFI_INGRESS_SECRET = secret;
  grantValid = true;
  grantSubject = dispatch.actorId;
  grantScopes = ["tax.invoice.prepare"];
  started = 0;
  startFailuresRemaining = 0;
  createdUserId = undefined;
  runUserId = undefined;
  bindingInput = undefined;
  storedRun = undefined;
});

describe("BUFI AI invoice Tax Automation ingress", () => {
  test("starts one durable workflow scoped to the signed Desk actor", async () => {
    const response = await POST(request(dispatch));
    expect(response.status).toBe(202);
    expect(started).toBe(1);
    expect(createdUserId).toBe(`desk_${dispatch.actorId}`);
    expect(runUserId).toBe(createdUserId);
    expect(bindingInput).toMatchObject({
      workspaceId,
      ledgerInvoiceId: dispatch.ledgerInvoiceId,
      idempotencyKey: dispatch.idempotencyKey,
    });
    expect(JSON.stringify(await response.json())).not.toContain(workspaceGrant);
  });

  test("fails closed for a missing grant or actor mismatch", async () => {
    grantValid = false;
    expect((await POST(request(dispatch, ""))).status).toBe(403);
    grantValid = true;
    grantSubject = "44444444-4444-4444-8444-444444444444";
    expect((await POST(request(dispatch))).status).toBe(403);
    expect(started).toBe(0);
  });

  test("requires the invoice preparation scope", async () => {
    grantScopes = ["knowledge.read"];
    expect((await POST(request(dispatch))).status).toBe(403);
    expect(started).toBe(0);
  });

  test("rejects AI arithmetic drift before creating a run", async () => {
    const response = await POST(
      request({
        ...dispatch,
        artifact: { ...dispatch.artifact, totalCents: 149_999 },
      }),
    );
    expect(response.status).toBe(422);
    expect(started).toBe(0);
  });

  test("restarts the same bound run after workflow start fails", async () => {
    startFailuresRemaining = 1;
    expect((await POST(request(dispatch))).status).toBe(503);
    expect(storedRun).toMatchObject({
      status: "failed",
      errorCode: "WORKFLOW_START_FAILED",
      workflowRunId: null,
    });

    const retry = await POST(request(dispatch));
    expect(retry.status).toBe(202);
    expect(await retry.json()).toMatchObject({
      status: "pending",
      replayed: true,
    });
    expect(started).toBe(2);
    expect(bindingInput).toMatchObject({
      ledgerInvoiceId: dispatch.ledgerInvoiceId,
    });
  });

  test("requires a canonical ledger invoice UUID distinct from the document", async () => {
    const { ledgerInvoiceId: _ledgerInvoiceId, ...withoutLedgerInvoice } =
      dispatch;
    expect((await POST(request(withoutLedgerInvoice))).status).toBe(400);
    expect(started).toBe(0);
  });

  test("requires the B2B ingress secret before parsing invoice data", async () => {
    const response = await POST(
      new Request("https://open-agents.test/api/bufi/tax-invoice", {
        method: "POST",
        body: JSON.stringify(dispatch),
      }) as NextRequest,
    );
    expect(response.status).toBe(401);
    expect(started).toBe(0);
  });
});

describe("BUFI Tax invoice status projection", () => {
  const executionId = "tax_abcdefghijklmnopqrstuvwxyz";

  function statusRequest() {
    const query = new URLSearchParams({
      workspaceId,
      actorId: dispatch.actorId,
    });
    return new Request(
      `https://open-agents.test/api/bufi/tax-invoice/${executionId}?${query}`,
      {
        headers: {
          authorization: `Bearer ${secret}`,
          "x-bufi-workspace-grant": workspaceGrant,
        },
      },
    );
  }

  function setStatusRun() {
    storedRun = {
      id: executionId,
      workspaceId,
      userId: `desk_${dispatch.actorId}`,
      packId: "tax_automation",
      workflowId: "ai_invoice_to_factura_e",
      status: "awaiting_approval",
      errorCode: null,
      updatedAt: new Date("2026-07-16T20:00:00.000Z"),
      result: {
        version: "tax-invoice-workflow-result-v1",
        taxRunId: "33333333-3333-4333-8333-333333333333",
        phase: "wsfex_submission_required",
        intentHash: "a".repeat(64),
        taxpayerReferenceHash: "b".repeat(64),
        foreignCustomerReferenceHash: "c".repeat(64),
        nextActions: ["submit_wsfex"],
        handoff: { customer: "must-not-cross" },
        revision: 7,
        approvalBoundary: "tax-engine-trusted-channel",
      },
    };
  }

  test("returns only the grant-scoped checkpoint needed by Desk", async () => {
    setStatusRun();
    const response = await GET_STATUS(statusRequest(), {
      params: Promise.resolve({ executionId }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toMatchObject({
      executionId,
      workspaceId,
      checkpoint: {
        taxRunId: "33333333-3333-4333-8333-333333333333",
        phase: "wsfex_submission_required",
        intentHash: "a".repeat(64),
        taxpayerReferenceHash: "b".repeat(64),
        foreignCustomerReferenceHash: "c".repeat(64),
      },
    });
    expect(JSON.stringify(body)).not.toContain("must-not-cross");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  test("fails closed for invalid grants and cross-workspace runs", async () => {
    setStatusRun();
    grantValid = false;
    expect(
      (
        await GET_STATUS(statusRequest(), {
          params: Promise.resolve({ executionId }),
        })
      ).status,
    ).toBe(403);
    grantValid = true;
    storedRun = {
      ...storedRun,
      workspaceId: "44444444-4444-4444-8444-444444444444",
    };
    expect(
      (
        await GET_STATUS(statusRequest(), {
          params: Promise.resolve({ executionId }),
        })
      ).status,
    ).toBe(404);
  });

  test("rejects malformed checkpoints instead of widening the response", async () => {
    setStatusRun();
    storedRun = {
      ...storedRun,
      result: {
        version: "tax-invoice-workflow-result-v1",
        handoff: { cae: "secret" },
      },
    };
    expect(
      (
        await GET_STATUS(statusRequest(), {
          params: Promise.resolve({ executionId }),
        })
      ).status,
    ).toBe(503);
  });
});
