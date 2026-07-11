import { describe, expect, test } from "bun:test";
import {
  TaxAutomationClient,
  advanceTaxInvoiceCase,
  prepareTaxInvoiceCase,
  taxRunIdFor,
  type TaxAutomationRun,
  type TaxInvoiceDispatch,
} from "./index";

const runId = "10000000-0000-4000-8000-000000000001";
const input: TaxInvoiceDispatch = {
  workspaceId: "11111111-1111-4111-8111-111111111111",
  actorId: "agent:tax",
  idempotencyKey: "tax-invoice:invoice-1",
  issuancePath: "reclaim_copilot",
  invoice: {
    invoiceId: "invoice-1",
    economicEventId: "invoice:invoice-1",
    artifactHash: "a".repeat(64),
    sourceEventHash: "b".repeat(64),
    consentVersion: "tax-consent-v1",
    foreignCustomerSafeLabel: "Foreign customer",
    destinationCountry: "US",
    destinationCountryArcaCode: 200,
    pointOfSale: 4,
    issueDate: "2026-07-11",
    paymentDate: "2026-07-11",
    sameCurrencyPayment: true,
    exchangeRate: null,
    total: { decimal: "1000.00", currency: "USD" },
    serviceDescription: "Software services used abroad",
    paymentTerms: "Due on receipt",
    unitCode: 7,
    observedAt: "2026-07-11T12:00:00.000Z",
  },
};

function run(overrides: Partial<TaxAutomationRun> = {}): TaxAutomationRun {
  return {
    runId,
    workspaceId: input.workspaceId,
    issuancePath: "reclaim_copilot",
    readinessState: "proof_pending",
    intentState: "missing",
    approvalState: "not_requested",
    issuanceState: "not_ready",
    settlementState: "unobserved",
    fxIngressState: "unverified",
    taxDeclarationState: "not_ready",
    financeEligibility: "frozen",
    intentHash: null,
    revision: 1,
    ...overrides,
  };
}

function response(value: unknown): Response {
  return Response.json(value);
}

describe("Tax Automation Engine agent bridge", () => {
  test("prepares accepted invoice evidence and starts a credential-less readiness handoff", async () => {
    let state = run();
    const requests: Array<{ path: string; body: unknown; headers: Headers }> =
      [];
    const client = new TaxAutomationClient({
      baseUrl: "https://tax.test",
      agentApiKey: "agent-key-at-least-sixteen",
      evidenceIngestToken: "evidence-token-at-least-sixteen",
      fetchImpl: async (url, init) => {
        const path = new URL(String(url)).pathname;
        const body = init?.body ? JSON.parse(String(init.body)) : null;
        requests.push({ path, body, headers: new Headers(init?.headers) });
        if (path === "/v1/evidence/append")
          return response({ data: { appended: 1 } });
        if (path.endsWith("tax_ar_factura_e_create_case/invoke"))
          return response({ data: { run: state, replayed: false } });
        if (path.endsWith("tax_ar_reclaim_start/invoke")) {
          state = run({ readinessState: "proof_pending", revision: 2 });
          return response({
            data: {
              run: state,
              output: { requestUrl: "https://reclaim.test/request" },
            },
          });
        }
        if (path === `/v1/agent/runs/${runId}`)
          return response({
            data: state,
            nextActions: ["request_arca_readiness_proof"],
          });
        throw new Error(`unexpected ${path}`);
      },
    });

    const checkpoint = await prepareTaxInvoiceCase(client, input, runId);
    expect(checkpoint).toMatchObject({
      phase: "readiness_interaction_required",
      handoff: { requestUrl: "https://reclaim.test/request" },
    });
    const evidence = requests.find(
      (request) => request.path === "/v1/evidence/append",
    )!;
    expect(evidence.headers.get("x-tax-evidence-ingest-token")).toBe(
      "evidence-token-at-least-sixteen",
    );
    const evidenceBody = evidence.body as {
      records: Array<Record<string, unknown>>;
    };
    expect(evidenceBody.records[0]).toMatchObject({
      money: { decimal: "1000.00", currency: "USD" },
      reviewState: "accepted",
      consentVersion: "tax-consent-v1",
    });
    expect(JSON.stringify(requests)).not.toContain("clave fiscal");
  });

  test("advances deterministically through external approval and verified authority states", async () => {
    let state = run({ readinessState: "verified", revision: 3 });
    const client = new TaxAutomationClient({
      baseUrl: "https://tax.test",
      agentApiKey: "agent-key-at-least-sixteen",
      evidenceIngestToken: "evidence-token-at-least-sixteen",
      fetchImpl: async (url) => {
        const path = new URL(String(url)).pathname;
        if (path === `/v1/agent/runs/${runId}`)
          return response({
            data: state,
            nextActions:
              state.approvalState === "pending"
                ? ["wait_for_user_approval"]
                : [],
          });
        if (path.endsWith("tax_ar_factura_e_propose_from_evidence/invoke")) {
          state = run({
            readinessState: "verified",
            intentState: "validated",
            intentHash: "c".repeat(64),
            revision: 4,
          });
          return response({ data: { run: state, output: { valid: true } } });
        }
        if (path.endsWith("tax_ar_factura_e_request_approval/invoke")) {
          state = run({
            readinessState: "verified",
            intentState: "frozen",
            approvalState: "pending",
            intentHash: "c".repeat(64),
            revision: 5,
          });
          return response({ data: { run: state } });
        }
        if (path.endsWith("tax_ar_factura_e_get_copilot_packet/invoke"))
          return response({
            data: {
              fields: { documentType: 19 },
              credentialBoundary: "ARCA only",
            },
          });
        if (
          path.endsWith(
            "tax_ar_factura_e_get_accounting_attestation_packet/invoke",
          )
        )
          return response({
            data: {
              invoice: { intentHash: "c".repeat(64) },
              accountingHandoff: { requiresApproval: true },
            },
          });
        throw new Error(`unexpected ${path}`);
      },
    });

    expect(await advanceTaxInvoiceCase(client, input, runId)).toMatchObject({
      phase: "approval_required",
      intentHash: "c".repeat(64),
      terminal: false,
    });
    state = run({
      readinessState: "verified",
      intentState: "frozen",
      approvalState: "user_approved",
      issuanceState: "manual_action_required",
      intentHash: "c".repeat(64),
      revision: 6,
    });
    expect(await advanceTaxInvoiceCase(client, input, runId)).toMatchObject({
      phase: "manual_arca_issuance_required",
      handoff: { fields: { documentType: 19 } },
    });
    state = run({
      readinessState: "verified",
      intentState: "frozen",
      approvalState: "user_approved",
      issuanceState: "arca_authorized",
      intentHash: "c".repeat(64),
      revision: 7,
    });
    expect(await advanceTaxInvoiceCase(client, input, runId)).toMatchObject({
      phase: "authorized",
      terminal: true,
      handoff: { accountingHandoff: { requiresApproval: true } },
    });
  });

  test("rejects insecure provider URLs and never accepts authority credentials", () => {
    expect(
      () =>
        new TaxAutomationClient({
          baseUrl: "http://tax.example.com",
          agentApiKey: "agent-key-at-least-sixteen",
          evidenceIngestToken: "evidence-token-at-least-sixteen",
        }),
    ).toThrow("HTTPS");
    expect(JSON.stringify(input).toLowerCase()).not.toContain("privatekey");
    expect(JSON.stringify(input).toLowerCase()).not.toContain("cuit");
    expect(taxRunIdFor(input.workspaceId, input.idempotencyKey)).toBe(
      taxRunIdFor(input.workspaceId, input.idempotencyKey),
    );
    expect(
      taxRunIdFor(input.workspaceId, `${input.idempotencyKey}:other`),
    ).not.toBe(taxRunIdFor(input.workspaceId, input.idempotencyKey));
  });
});
