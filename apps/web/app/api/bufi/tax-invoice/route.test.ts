import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { NextRequest } from "next/server";

let grantValid = true;
let grantSubject = "22222222-2222-4222-8222-222222222222";
let grantScopes = ["tax.invoice.prepare"];
let existingRun = false;
let started = 0;
let createdUserId: string | undefined;
let runUserId: string | undefined;

mock.module("@/lib/operating-packs/desk-grant", () => ({
  verifyDeskWorkspaceGrant: () =>
    grantValid ? { subject: grantSubject, scopes: grantScopes } : null,
}));

mock.module("@/lib/operating-packs/desk-bridge-user", () => ({
  ensureDeskBridgeUser: async (subject: string) => `desk_${subject}`,
}));

mock.module("@/lib/db/operating-pack-runs", () => ({
  getOperatingPackRunByIdempotency: async () =>
    existingRun
      ? {
          id: "tax_existing",
          workflowRunId: "wfr_existing",
          status: "running",
          requestHash: requestHash,
          result: null,
        }
      : null,
  createOperatingPackRun: async (input: Record<string, unknown>) => {
    runUserId = String(input.userId);
    return { created: true, run: input };
  },
  updateOperatingPackRun: async () => undefined,
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
    return { runId: "wfr_tax_1" };
  },
  getRun: () => ({ status: Promise.resolve("running") }),
  resumeHook: async () => undefined,
}));

const { POST } = await import("./route");

const secret = "shared-ingress-secret-at-least-sixteen";
const workspaceGrant = "signed-workspace-grant".padEnd(100, "x");
const workspaceId = "11111111-1111-4111-8111-111111111111";
const requestHash = "request-hash";

const dispatch = {
  workspaceId,
  actorId: grantSubject,
  idempotencyKey: "tax-invoice:33333333-3333-4333-8333-333333333333",
  issuancePath: "reclaim_copilot" as const,
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
  existingRun = false;
  started = 0;
  createdUserId = undefined;
  runUserId = undefined;
});

describe("BUFI AI invoice Tax Automation ingress", () => {
  test("starts one durable workflow scoped to the signed Desk actor", async () => {
    const response = await POST(request(dispatch));
    expect(response.status).toBe(202);
    expect(started).toBe(1);
    expect(createdUserId).toBe(`desk_${dispatch.actorId}`);
    expect(runUserId).toBe(createdUserId);
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
