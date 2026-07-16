import { beforeEach, describe, expect, mock, test } from "bun:test";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const taxRunId = "33333333-3333-4333-8333-333333333333";
const invoiceId = "44444444-4444-4444-8444-444444444444";
const executionId = "tax_abcdefghijklmnopqrstuvwxyz";

let scopes = ["tax.invoice.authority.sync"];
let bindingTaxRunId = taxRunId;
let runResult: Record<string, unknown>;

mock.module("@/lib/operating-packs/desk-grant", () => ({
  verifyDeskWorkspaceGrant: () => ({ subject: actorId, scopes }),
}));
mock.module("@/lib/operating-packs/desk-bridge-user", () => ({
  deskBridgeUserId: (subject: string) => `desk_${subject}`,
}));
mock.module("@/lib/db/operating-pack-runs", () => ({
  getOperatingPackRun: async () => ({
    id: executionId,
    workspaceId,
    userId: `desk_${actorId}`,
    packId: "tax_automation",
    workflowId: "ai_invoice_to_factura_e",
    result: runResult,
  }),
}));
mock.module("@/lib/db/tax-settlements", () => ({
  getTaxInvoiceBindingByOperatingPackRun: async () => ({
    workspaceId,
    ledgerInvoiceId: invoiceId,
    operatingPackRunId: executionId,
    taxRunId: bindingTaxRunId,
  }),
}));

const { GET } = await import("./route");

function request() {
  return new Request(
    `https://open-agents.test/api/bufi/tax-invoice/${executionId}/authority?workspaceId=${workspaceId}&actorId=${actorId}`,
    {
      headers: {
        authorization: "Bearer ingress-secret-at-least-thirty-two-characters",
        "x-bufi-workspace-grant": "signed-grant",
      },
    },
  );
}

beforeEach(() => {
  process.env.OPEN_AGENTS_BUFI_INGRESS_SECRET =
    "ingress-secret-at-least-thirty-two-characters";
  scopes = ["tax.invoice.authority.sync"];
  bindingTaxRunId = taxRunId;
  runResult = {
    version: "tax-invoice-workflow-result-v1",
    taxRunId,
    phase: "settlement_pending",
    intentHash: "a".repeat(64),
    nextActions: ["reconcile_final_settlement"],
    revision: 9,
    approvalBoundary: "tax-engine-trusted-channel",
    handoff: {
      version: "factura-e-accounting-attestation-packet-v1",
      runId: taxRunId,
      workspaceId,
      generatedFromRevision: 9,
      invoice: {
        intentHash: "a".repeat(64),
        documentType: 19,
        pointOfSale: 4,
        invoiceNumber: "51",
        cae: "98765432109876",
        caeExpiry: "2026-07-21",
        currencyId: "DOL",
        currencyQuote: "1200.25",
        authorizedAt: "2026-07-16T20:00:00.000Z",
        authorityReceiptHash: "b".repeat(64),
        issueDate: "2026-07-16",
        foreignCustomerSafeLabel: "must-not-cross",
      },
      settlements: [{ raw: "must-not-cross" }],
    },
  };
});

describe("BUFI Tax invoice official authority projection", () => {
  test("returns only the bound CAE tuple for server-side Desk persistence", async () => {
    const response = await GET(request(), {
      params: Promise.resolve({ executionId }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toMatchObject({
      executionId,
      workspaceId,
      ledgerInvoiceId: invoiceId,
      taxRunId,
      intentHash: "a".repeat(64),
      invoice: {
        documentType: 19,
        pointOfSale: 4,
        invoiceNumber: "51",
        cae: "98765432109876",
      },
    });
    expect(JSON.stringify(body)).not.toContain("must-not-cross");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  test("requires the dedicated sync scope and exact Tax binding", async () => {
    scopes = ["tax.invoice.prepare"];
    expect(
      (await GET(request(), { params: Promise.resolve({ executionId }) }))
        .status,
    ).toBe(403);
    scopes = ["tax.invoice.authority.sync"];
    bindingTaxRunId = "55555555-5555-4555-8555-555555555555";
    expect(
      (await GET(request(), { params: Promise.resolve({ executionId }) }))
        .status,
    ).toBe(409);
  });

  test("rejects unverified and malformed authority handoffs", async () => {
    runResult = { ...runResult, phase: "authority_pending" };
    expect(
      (await GET(request(), { params: Promise.resolve({ executionId }) }))
        .status,
    ).toBe(409);
    runResult = {
      ...runResult,
      phase: "settlement_pending",
      handoff: { cae: "98765432109876" },
    };
    expect(
      (await GET(request(), { params: Promise.resolve({ executionId }) }))
        .status,
    ).toBe(409);
  });
});
