import { describe, expect, test } from "bun:test";
import { createHash, createHmac } from "node:crypto";
import {
  buildTaxSnapshotProblemV1,
  taxSnapshotReadResultV1Schema,
  type TaxWidgetSnapshotReceiptV1,
  type TaxWidgetSnapshotV1,
} from "@tax-engine/browser-contracts";
import {
  argentinaTaxWidgetSnapshotReceiptV1Fixture,
  facturaENeedsConsentProjectionV1Fixture,
} from "@tax-engine/browser-contracts/fixtures";
import {
  AiInvoiceDocumentDispatchSchema,
  AiInvoiceArtifactDispatchSchema,
  TaxAutomationClient,
  advanceTaxInvoiceCase,
  dispatchFromAiInvoiceArtifact,
  dispatchFromAiInvoiceDocument,
  prepareTaxInvoiceCase,
  settlementReferenceHashForEvent,
  taxRunIdFor,
  type TaxAutomationRun,
  type TaxInvoiceDispatch,
  type InvoiceSettlementEventV1,
  type ForwardedTaxTenantPrincipalHeaders,
} from "./index";

const aiArtifactInput = {
  workspaceId: "11111111-1111-4111-8111-111111111111",
  actorId: "agent:tax",
  idempotencyKey: "tax-invoice:ai-document-1",
  issuancePath: "reclaim_copilot" as const,
  ledgerInvoiceId: "33333333-3333-4333-8333-333333333333",
  artifact: {
    documentId: "ai-document-1",
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
    note: "Due on receipt",
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

const runId = "10000000-0000-4000-8000-000000000001";
const input: TaxInvoiceDispatch = {
  workspaceId: "11111111-1111-4111-8111-111111111111",
  actorId: "agent:tax",
  idempotencyKey: "tax-invoice:invoice-1",
  issuancePath: "reclaim_copilot",
  invoice: {
    ledgerInvoiceId: "33333333-3333-4333-8333-333333333333",
    artifactId: "invoice-document-1",
    economicEventId: "invoice:33333333-3333-4333-8333-333333333333",
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

const settlementEvent: InvoiceSettlementEventV1 = {
  schemaVersion: 1,
  eventType: "InvoiceSettlementFinalizedV1",
  eventId: "20000000-0000-4000-8000-000000000001",
  teamId: input.workspaceId,
  invoiceId: input.invoice.ledgerInvoiceId,
  billId: null,
  settlementId: "20000000-0000-4000-8000-000000000003",
  allocationId: "20000000-0000-4000-8000-000000000004",
  allocationRevision: 1,
  replayKey: "e".repeat(64),
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
    identityHash: "f".repeat(64),
    revision: 1,
  },
  evidence: {
    status: "verified",
    method: "provider_webhook",
    hashAlgorithm: "sha256",
    evidenceRef: "20000000-0000-4000-8000-000000000005",
    evidenceHash: "a".repeat(64),
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

function response(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

function forwardedSnapshotPrincipal(
  workspaceId = input.workspaceId,
  actorId = input.actorId,
  expiresAt = new Date(Date.now() + 240_000).toISOString(),
): ForwardedTaxTenantPrincipalHeaders {
  return {
    "x-tax-tenant-principal": Buffer.from(
      JSON.stringify({
        version: "tax-tenant-principal-v2",
        workspaceId,
        actorId,
        capability: "snapshot:read",
        expiresAt,
      }),
      "utf8",
    ).toString("base64url"),
    "x-tax-tenant-signature": "f".repeat(64),
  };
}

function forwardedFactoringPrincipal(
  workspaceId = input.workspaceId,
  actorId = input.actorId,
  expiresAt = new Date(Date.now() + 240_000).toISOString(),
): ForwardedTaxTenantPrincipalHeaders {
  return {
    "x-tax-tenant-principal": Buffer.from(
      JSON.stringify({
        version: "tax-tenant-principal-v2",
        workspaceId,
        actorId,
        capability: "tax.factoring.read",
        expiresAt,
      }),
      "utf8",
    ).toString("base64url"),
    "x-tax-tenant-signature": "f".repeat(64),
  };
}

function forwardedAccountantPortfolioPrincipal(
  workspaceId = input.workspaceId,
  actorId = input.actorId,
): ForwardedTaxTenantPrincipalHeaders {
  return {
    "x-tax-tenant-principal": Buffer.from(
      JSON.stringify({
        version: "tax-tenant-principal-v2",
        workspaceId,
        actorId,
        capability: "accountant:portfolio",
        expiresAt: new Date(Date.now() + 240_000).toISOString(),
      }),
      "utf8",
    ).toString("base64url"),
    "x-tax-tenant-signature": "f".repeat(64),
  };
}

describe("Tax Automation Engine agent bridge", () => {
  test("locks the Tax v2 snapshot-read principal wire vector", () => {
    const encoded =
      "eyJ2ZXJzaW9uIjoidGF4LXRlbmFudC1wcmluY2lwYWwtdjIiLCJ3b3Jrc3BhY2VJZCI6IndvcmtzcGFjZTpsZWdhY3ktMSIsImFjdG9ySWQiOiJ1c2VyOmdvbGRlbiIsImNhcGFiaWxpdHkiOiJzbmFwc2hvdDpyZWFkIiwiZXhwaXJlc0F0IjoiMjAyNi0wNy0xMFQwMDowNTowMC4wMDBaIn0";
    expect(
      Buffer.from(
        JSON.stringify({
          version: "tax-tenant-principal-v2",
          workspaceId: "workspace:legacy-1",
          actorId: "user:golden",
          capability: "snapshot:read",
          expiresAt: "2026-07-10T00:05:00.000Z",
        }),
        "utf8",
      ).toString("base64url"),
    ).toBe(encoded);
    expect(
      createHmac("sha256", "tax-principal-golden-secret")
        .update(encoded, "utf8")
        .digest("hex"),
    ).toBe("024941b683fcac0e8fa9f49b7ef4456af521bf71bb8f87cf714ad402439f4761");
  });

  test("chains the persisted BUFI AI invoice document into the durable workflow", () => {
    const dispatch = dispatchFromAiInvoiceDocument({
      workspaceId: aiArtifactInput.workspaceId,
      actorId: aiArtifactInput.actorId,
      idempotencyKey: "tax-invoice:desk-document-1",
      issuancePath: "reclaim_copilot",
      ledgerInvoiceId: aiArtifactInput.ledgerInvoiceId,
      document: {
        id: "desk-document-1",
        kind: "invoice",
        content: JSON.stringify({
          invoiceNumber: "INV-2026-001",
          title: "July software services",
          customerName: "Foreign customer",
          customerEmail: "billing@example.com",
          issueDate: "2026-07-11",
          dueDate: "2026-08-10",
          currency: "USD",
          lineItems: [
            {
              name: "Software services used abroad",
              quantity: 1.5,
              price: 100_000,
            },
          ],
          subtotal: 150_000,
          taxAmount: 0,
          discountAmount: 0,
          total: 150_000,
          status: "draft",
        }),
      },
      exportContext: aiArtifactInput.exportContext,
    });

    expect(dispatch).toMatchObject({
      invoice: {
        ledgerInvoiceId: aiArtifactInput.ledgerInvoiceId,
        artifactId: "desk-document-1",
        total: { decimal: "1500.00", currency: "USD" },
        foreignCustomerSafeLabel: "Foreign customer",
      },
    });
    expect(dispatch.invoice.artifactHash).toHaveLength(64);
  });

  test("rejects authority fields and arithmetic drift in AI invoice documents", () => {
    const base = {
      workspaceId: aiArtifactInput.workspaceId,
      actorId: aiArtifactInput.actorId,
      idempotencyKey: "tax-invoice:desk-document-bad",
      issuancePath: "reclaim_copilot" as const,
      ledgerInvoiceId: aiArtifactInput.ledgerInvoiceId,
      document: {
        id: "desk-document-bad",
        kind: "invoice" as const,
        content: JSON.stringify({
          invoiceNumber: "INV-BAD",
          title: "Bad invoice",
          customerName: "Foreign customer",
          issueDate: "2026-07-11",
          dueDate: "2026-08-10",
          currency: "USD",
          lineItems: [{ name: "Service", quantity: 1, price: 100_000 }],
          subtotal: 100_000,
          total: 99_999,
          cae: "12345678901234",
        }),
      },
      exportContext: aiArtifactInput.exportContext,
    };
    expect(() => dispatchFromAiInvoiceDocument(base)).toThrow();
    expect(
      AiInvoiceDocumentDispatchSchema.safeParse({
        ...base,
        document: { ...base.document, kind: "text" },
      }).success,
    ).toBe(false);
  });

  test("turns an AI invoice artifact into exact, hash-bound tax evidence", () => {
    const first = dispatchFromAiInvoiceArtifact(aiArtifactInput);
    const replay = dispatchFromAiInvoiceArtifact({
      ...aiArtifactInput,
      artifact: { ...aiArtifactInput.artifact },
    });
    expect(first).toMatchObject({
      invoice: {
        ledgerInvoiceId: aiArtifactInput.ledgerInvoiceId,
        artifactId: "ai-document-1",
        total: { decimal: "1500.00", currency: "USD" },
        serviceDescription: "Software services used abroad",
      },
    });
    expect(first.invoice.artifactHash).toBe(replay.invoice.artifactHash);
    expect(first.invoice.sourceEventHash).toBe(replay.invoice.sourceEventHash);
    expect(first.invoice.artifactHash).toHaveLength(64);
    expect(first.invoice.ledgerInvoiceId).not.toBe(first.invoice.artifactId);
    const anotherLedgerInvoice = dispatchFromAiInvoiceArtifact({
      ...aiArtifactInput,
      ledgerInvoiceId: "44444444-4444-4444-8444-444444444444",
    });
    expect(anotherLedgerInvoice.invoice.artifactHash).toBe(
      first.invoice.artifactHash,
    );
    expect(anotherLedgerInvoice.invoice.sourceEventHash).not.toBe(
      first.invoice.sourceEventHash,
    );
  });

  test("blocks AI arithmetic drift and authority-shaped fields", () => {
    expect(() =>
      dispatchFromAiInvoiceArtifact({
        ...aiArtifactInput,
        artifact: { ...aiArtifactInput.artifact, totalCents: 149_999 },
      }),
    ).toThrow("does not reconcile exactly");
    expect(() =>
      dispatchFromAiInvoiceArtifact({
        ...aiArtifactInput,
        artifact: {
          ...aiArtifactInput.artifact,
          lineItems: [
            {
              name: "Fractional minor unit",
              quantityDecimal: "0.001",
              unitPriceCents: 1,
            },
          ],
          subtotalCents: 0,
          totalCents: 0,
        },
      }),
    ).toThrow("fractional minor units");
    expect(
      AiInvoiceArtifactDispatchSchema.safeParse({
        ...aiArtifactInput,
        exportContext: { ...aiArtifactInput.exportContext, cae: "123456" },
      }).success,
    ).toBe(false);
  });

  test("starts a credential-less readiness handoff without bypassing Desk evidence transport", async () => {
    let state = run();
    const requests: Array<{ path: string; body: unknown; headers: Headers }> =
      [];
    const client = new TaxAutomationClient({
      baseUrl: "https://tax.test",
      agentApiKey: "agent-key-at-least-sixteen",
      agentPrincipalSecret: "open-agents-tax-agent-principal-secret-32",
      fetchImpl: async (url, init) => {
        const path = new URL(String(url)).pathname;
        const body = init?.body ? JSON.parse(String(init.body)) : null;
        requests.push({ path, body, headers: new Headers(init?.headers) });
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
    expect(
      requests.some((request) => request.path === "/v1/evidence/append"),
    ).toBe(false);
    expect(
      requests.some((request) =>
        request.headers.has("x-tax-evidence-ingest-token"),
      ),
    ).toBe(false);
    expect(JSON.stringify(requests)).not.toContain("clave fiscal");
  });

  test("sends a finalized invoice settlement through the exact Tax Engine action", async () => {
    const requests: Array<{ path: string; body: unknown; headers: Headers }> =
      [];
    const settledRun = run({ settlementState: "final", revision: 12 });
    const client = new TaxAutomationClient({
      baseUrl: "https://tax.test",
      agentApiKey: "agent-key-at-least-sixteen",
      agentPrincipalSecret: "open-agents-tax-agent-principal-secret-32",
      fetchImpl: async (url, init) => {
        const path = new URL(String(url)).pathname;
        const body = init?.body ? JSON.parse(String(init.body)) : null;
        requests.push({ path, body, headers: new Headers(init?.headers) });
        return response({
          data: { run: settledRun, replayed: true },
        });
      },
    });

    const result = await client.recordInvoiceSettlement(runId, settlementEvent);

    expect(requests).toHaveLength(1);
    expect(requests[0]?.path).toBe(
      "/v1/agent/tools/tax_ar_factura_e_record_settlement/invoke",
    );
    expect(requests[0]?.headers.get("authorization")).toBe(
      "Bearer agent-key-at-least-sixteen",
    );
    const encodedPrincipal = requests[0]?.headers.get("x-tax-agent-principal");
    expect(encodedPrincipal).toBeTruthy();
    const principal = JSON.parse(
      Buffer.from(encodedPrincipal!, "base64url").toString("utf8"),
    );
    expect(principal).toMatchObject({
      version: "tax-agent-principal-v1",
      workspaceId: settlementEvent.teamId,
      actorId: "agent:tax-settlement",
      toolId: "tax_ar_factura_e_record_settlement",
      method: "POST",
      path: "/v1/agent/tools/tax_ar_factura_e_record_settlement/invoke",
      idempotencyKey: `invoice-settlement:${settlementEvent.eventId}`,
    });
    expect(requests[0]?.body).toEqual({
      actorId: "agent:tax-settlement",
      idempotencyKey: `invoice-settlement:${settlementEvent.eventId}`,
      input: {
        runId,
        settlement: {
          settlementReferenceHash: settlementReferenceHashForEvent(
            settlementEvent.eventId,
          ),
          asset: "USDC",
          network: "base",
          amount: { decimal: "100.00", currency: "USDC" },
          observedAt: settlementEvent.finalizedAt,
          finalityState: "final",
          fees: { decimal: "0.50", currency: "USDC" },
          reversesSettlementReferenceHash: null,
          evidence: {
            version: "factura-e-settlement-evidence-v1",
            source: settlementEvent.source,
            sourceMoney: settlementEvent.sourceMoney,
            sourceEquivalentAmount: settlementEvent.sourceEquivalentAmount,
            allocationBasis: settlementEvent.allocationBasis,
            fx: null,
            verification: {
              method: settlementEvent.evidence.method,
              evidenceHash: settlementEvent.evidence.evidenceHash,
              verifiedAt: settlementEvent.evidence.verifiedAt,
            },
          },
        },
      },
    });
    expect(principal.bodyHash).toBe(
      createHash("sha256")
        .update(JSON.stringify(requests[0]?.body), "utf8")
        .digest("hex"),
    );
    expect(requests[0]?.headers.get("x-tax-agent-principal-signature")).toMatch(
      /^[a-f0-9]{64}$/,
    );
    expect(result).toEqual({ run: settledRun, replayed: true });
    expect(result.run.revision).toBe(12);
  });

  test("keeps the legacy internal snapshot reader available during browser V1 rollout", async () => {
    const snapshot = {
      version: "tax-widget-v1" as const,
      workspaceId: input.workspaceId,
      period: { start: "2026-07-01", end: "2026-07-31" },
      displayCurrency: "ARS",
      inputHash: "d".repeat(64),
      sourceCoverage: [],
      warnings: ["Bank evidence is unavailable"],
    };
    let requestedPath: string | undefined;
    const client = new TaxAutomationClient({
      baseUrl: "https://tax.test",
      agentApiKey: "agent-key-at-least-sixteen",
      agentPrincipalSecret: "open-agents-tax-agent-principal-secret-32",
      fetchImpl: async (url) => {
        requestedPath = new URL(String(url)).pathname;
        return response({ data: snapshot });
      },
    });

    await expect(client.getLatestSnapshot(input.workspaceId)).resolves.toEqual(
      snapshot,
    );
    expect(requestedPath).toBe(`/v1/snapshots/${input.workspaceId}`);
  });

  test("rejects and cancels an oversized chunked Tax response", async () => {
    let cancelled = false;
    const client = new TaxAutomationClient({
      baseUrl: "https://tax.test",
      agentApiKey: "agent-key-at-least-sixteen",
      agentPrincipalSecret: "open-agents-tax-agent-principal-secret-32",
      fetchImpl: async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              controller.enqueue(new Uint8Array(300_000));
            },
            cancel() {
              cancelled = true;
            },
          }),
          { headers: { "content-type": "application/json" } },
        ),
    });

    await expect(client.getLatestSnapshot(input.workspaceId)).rejects.toThrow(
      "Tax Automation Engine returned invalid JSON data",
    );
    expect(cancelled).toBe(true);
  });

  test("reads the exact frozen browser V1 result with a forwarded scoped principal", async () => {
    const requests: Array<{ path: string; headers: Headers }> = [];
    const forwardedPrincipal = forwardedSnapshotPrincipal();
    const result = {
      ok: true as const,
      data: argentinaTaxWidgetSnapshotReceiptV1Fixture,
    };
    const client = new TaxAutomationClient({
      baseUrl: "https://tax.test",
      agentApiKey: "agent-key-at-least-sixteen",
      agentPrincipalSecret: "open-agents-tax-agent-principal-secret-32",
      fetchImpl: async (url, init) => {
        requests.push({
          path: new URL(String(url)).pathname,
          headers: new Headers(init?.headers),
        });
        return response(result);
      },
    });

    await expect(
      client.getBrowserSnapshot(
        input.workspaceId,
        input.actorId,
        forwardedPrincipal,
        "annual:2026",
      ),
    ).resolves.toEqual(result);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.path).toBe(
      `/v1/browser/snapshots/${input.workspaceId}/annual%3A2026`,
    );
    expect(requests[0]?.headers.get("authorization")).toBe(
      "Bearer agent-key-at-least-sixteen",
    );
    expect(requests[0]?.headers.get("x-tax-tenant-principal")).toBe(
      forwardedPrincipal["x-tax-tenant-principal"],
    );
    expect(requests[0]?.headers.get("x-tax-tenant-signature")).toBe(
      forwardedPrincipal["x-tax-tenant-signature"],
    );
  });

  test("passes consented evidence quality exactly without touching factoring score bytes", async () => {
    const quality = {
      version: "tax-evidence-quality-v1",
      purpose: "tax_evidence_quality",
      state: "ready",
      value: 88,
      band: "strong",
      dimensions: (
        [
          ["subject_workspace_binding", 25, 25],
          ["source_provenance_verification", 23, 25],
          ["freshness_expiry", 18, 20],
          ["required_evidence_coverage", 17, 20],
          ["reviewed_reconciliation", 5, 10],
        ] as const
      ).map(([id, score, weight]) => ({
        id,
        score,
        weight,
        safeSourceRefs: ["source:quality-safe-ref"],
        safeRevisionRefs: ["evidence:quality-safe-revision"],
        bindingState: "verified",
        freshnessState: "current",
        reviewState: "accepted",
        supersessionState: "current",
        limitationCodes:
          score === weight ? [] : [`${String(id).toUpperCase()}_INCOMPLETE`],
        ruleVersion: "rule:tax-evidence-quality-v1",
      })),
      reasonCodes: [
        "SOURCE_PROVENANCE_VERIFICATION_INCOMPLETE",
        "FRESHNESS_EXPIRY_INCOMPLETE",
        "REQUIRED_EVIDENCE_COVERAGE_INCOMPLETE",
        "REVIEWED_RECONCILIATION_INCOMPLETE",
      ],
      authorizedActionIds: [],
      consentVersion: "consent:quality-v1",
      consentScopeRevision: "consent:quality_scope_revision_0001",
      asOf: argentinaTaxWidgetSnapshotReceiptV1Fixture.asOf,
      validUntil: argentinaTaxWidgetSnapshotReceiptV1Fixture.expiresAt,
      safeSourceRefs: ["source:quality-safe-ref"],
      limitationCodes: ["TAX_EVIDENCE_QUALITY_INCOMPLETE"],
      use: "tax_evidence_only",
      affectsCredit: false,
      affectsFactoring: false,
    } satisfies NonNullable<TaxWidgetSnapshotV1["supplementalEvidenceQuality"]>;
    const receipt: TaxWidgetSnapshotReceiptV1 = {
      ...argentinaTaxWidgetSnapshotReceiptV1Fixture,
      snapshot: {
        ...argentinaTaxWidgetSnapshotReceiptV1Fixture.snapshot,
        supplementalEvidenceQuality: quality,
      },
    };
    const result = { ok: true as const, data: receipt };
    const parsed = taxSnapshotReadResultV1Schema.safeParse(result);
    if (!parsed.success) {
      throw new Error(
        parsed.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("\n"),
      );
    }
    const factoringBytes = JSON.stringify(
      facturaENeedsConsentProjectionV1Fixture,
    );
    const client = new TaxAutomationClient({
      baseUrl: "https://tax.test",
      agentApiKey: "agent-key-at-least-sixteen",
      agentPrincipalSecret: "open-agents-tax-agent-principal-secret-32",
      fetchImpl: async () => response(result),
    });

    const read = await client.getBrowserSnapshot(
      input.workspaceId,
      input.actorId,
      forwardedSnapshotPrincipal(),
      "annual:2026",
    );
    expect(read).toEqual(result);
    expect(JSON.stringify(facturaENeedsConsentProjectionV1Fixture)).toBe(
      factoringBytes,
    );
  });

  test("preserves canonical 404, 409, and 410 browser problem results", async () => {
    for (const code of [
      "TAX_SNAPSHOT_NOT_FOUND",
      "TAX_SNAPSHOT_STALE",
      "TAX_SNAPSHOT_EXPIRED",
    ] as const) {
      const problem = buildTaxSnapshotProblemV1(code);
      const result = { ok: false as const, problem };
      const client = new TaxAutomationClient({
        baseUrl: "https://tax.test",
        agentApiKey: "agent-key-at-least-sixteen",
        agentPrincipalSecret: "open-agents-tax-agent-principal-secret-32",
        fetchImpl: async () => response(result, problem.status),
      });

      await expect(
        client.getBrowserSnapshot(
          input.workspaceId,
          input.actorId,
          forwardedSnapshotPrincipal(),
          "annual:2026",
        ),
      ).resolves.toEqual(result);
    }
  });

  test("reads an accountant portfolio only for the exact firm and actor", async () => {
    const portfolio = {
      version: "accountant-portfolio-projection-v1" as const,
      accountantActorId: input.actorId,
      accountantOrganizationId: input.workspaceId,
      asOf: "2026-07-16T12:00:00.000Z",
      clients: [
        {
          version: "accountant-client-case-summary-v1" as const,
          workspaceId: "33333333-3333-4333-8333-333333333333",
          nextDueAt: "2026-07-20T12:00:00.000Z",
          outstandingObligationCount: 2,
          professionalReviewCount: 1,
          clientApprovalCount: 1,
        },
      ],
      mandates: [
        {
          version: "accountant-mandate-v1" as const,
          mandateId: "mandate:review",
          workspaceId: "33333333-3333-4333-8333-333333333333",
          accountantActorId: input.actorId,
          accountantOrganizationId: input.workspaceId,
          scopes: ["review_tax_obligation" as const],
          grantedByActorId: "user:client-owner",
          grantedAt: "2026-07-15T12:00:00.000Z",
          expiresAt: "2026-08-15T12:00:00.000Z",
          revokedAt: null,
        },
      ],
      totals: {
        authorizedClientCount: 1,
        outstandingObligationCount: 2,
        professionalReviewCount: 1,
        clientApprovalCount: 1,
      },
    };
    const client = new TaxAutomationClient({
      baseUrl: "https://tax.test",
      agentApiKey: "agent-key-at-least-sixteen",
      agentPrincipalSecret: "open-agents-tax-agent-principal-secret-32",
      fetchImpl: async () => response({ data: portfolio }),
    });
    await expect(
      client.getAccountantPortfolio(
        input.workspaceId,
        input.actorId,
        forwardedAccountantPortfolioPrincipal(),
      ),
    ).resolves.toEqual(portfolio);
    await expect(
      client.getAccountantPortfolio(
        input.workspaceId,
        input.actorId,
        forwardedSnapshotPrincipal(),
      ),
    ).rejects.toThrow("TAX_SNAPSHOT_PRINCIPAL_SCOPE_MISMATCH");
  });

  test("reads the exact Factura E factoring projection without adding an action", async () => {
    const requests: Array<{ path: string; headers: Headers }> = [];
    const forwardedPrincipal = forwardedFactoringPrincipal();
    const result = {
      state: "ready" as const,
      receipt: {
        version: "factura-e-factoring-projection-receipt-v1" as const,
        projectionKey: "annual:2026",
        revision: 1,
        projectedAt: "2026-07-16T12:00:00.000Z",
        projection: facturaENeedsConsentProjectionV1Fixture,
      },
    };
    const client = new TaxAutomationClient({
      baseUrl: "https://tax.test",
      agentApiKey: "agent-key-at-least-sixteen",
      agentPrincipalSecret: "open-agents-tax-agent-principal-secret-32",
      fetchImpl: async (url, init) => {
        requests.push({
          path: new URL(String(url)).pathname,
          headers: new Headers(init?.headers),
        });
        return response(result);
      },
    });

    await expect(
      client.getBrowserFactoringProjection(
        input.workspaceId,
        input.actorId,
        forwardedPrincipal,
        "annual:2026",
      ),
    ).resolves.toEqual(result);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.path).toBe(
      `/v1/browser/factoring-projections/${input.workspaceId}/annual%3A2026`,
    );
    expect(requests[0]?.headers.get("x-tax-tenant-principal")).toBe(
      forwardedPrincipal["x-tax-tenant-principal"],
    );
  });

  test("preserves a missing factoring projection and rejects mismatched wire data", async () => {
    const missing = {
      state: "unavailable" as const,
      code: "FACTURA_E_FACTORING_PROJECTION_NOT_FOUND" as const,
    };
    const missingClient = new TaxAutomationClient({
      baseUrl: "https://tax.test",
      agentApiKey: "agent-key-at-least-sixteen",
      agentPrincipalSecret: "open-agents-tax-agent-principal-secret-32",
      fetchImpl: async () => response(missing, 404),
    });
    await expect(
      missingClient.getBrowserFactoringProjection(
        input.workspaceId,
        input.actorId,
        forwardedFactoringPrincipal(),
        "annual:2026",
      ),
    ).resolves.toEqual(missing);

    const invalidClient = new TaxAutomationClient({
      baseUrl: "https://tax.test",
      agentApiKey: "agent-key-at-least-sixteen",
      agentPrincipalSecret: "open-agents-tax-agent-principal-secret-32",
      fetchImpl: async () =>
        response({
          state: "ready",
          receipt: {
            version: "factura-e-factoring-projection-receipt-v1",
            projectionKey: "another:projection",
            revision: 1,
            projectedAt: "2026-07-16T12:00:00.000Z",
            projection: facturaENeedsConsentProjectionV1Fixture,
          },
        }),
    });
    await expect(
      invalidClient.getBrowserFactoringProjection(
        input.workspaceId,
        input.actorId,
        forwardedFactoringPrincipal(),
        "annual:2026",
      ),
    ).rejects.toThrow("TAX_FACTORING_PROJECTION_RESPONSE_INVALID");
  });

  test("rejects snapshot-read authority on the factoring-only reader", async () => {
    let requestCount = 0;
    const client = new TaxAutomationClient({
      baseUrl: "https://tax.test",
      agentApiKey: "agent-key-at-least-sixteen",
      agentPrincipalSecret: "open-agents-tax-agent-principal-secret-32",
      fetchImpl: async () => {
        requestCount += 1;
        return response({});
      },
    });

    await expect(
      client.getBrowserFactoringProjection(
        input.workspaceId,
        input.actorId,
        forwardedSnapshotPrincipal(),
        "annual:2026",
      ),
    ).rejects.toThrow("TAX_SNAPSHOT_PRINCIPAL_SCOPE_MISMATCH");
    expect(requestCount).toBe(0);
  });

  test("fails closed when browser snapshot principal headers are missing", async () => {
    let requestCount = 0;
    const client = new TaxAutomationClient({
      baseUrl: "https://tax.test",
      agentApiKey: "agent-key-at-least-sixteen",
      agentPrincipalSecret: "open-agents-tax-agent-principal-secret-32",
      fetchImpl: async () => {
        requestCount += 1;
        return response({});
      },
    });

    await expect(
      // @ts-expect-error The runtime boundary must also reject an omitted pair.
      client.getBrowserSnapshot(input.workspaceId, input.actorId),
    ).rejects.toThrow("TAX_SNAPSHOT_PRINCIPAL_INVALID");
    expect(requestCount).toBe(0);
  });

  test("rejects malformed, non-canonical, expired, and overlong snapshot principals", async () => {
    let requestCount = 0;
    const client = new TaxAutomationClient({
      baseUrl: "https://tax.test",
      agentApiKey: "agent-key-at-least-sixteen",
      agentPrincipalSecret: "open-agents-tax-agent-principal-secret-32",
      fetchImpl: async () => {
        requestCount += 1;
        return response({});
      },
    });
    const nonCanonical = {
      "x-tax-tenant-principal": Buffer.from(
        JSON.stringify({
          workspaceId: input.workspaceId,
          version: "tax-tenant-principal-v2",
          actorId: input.actorId,
          capability: "snapshot:read",
          expiresAt: new Date(Date.now() + 240_000).toISOString(),
        }),
      ).toString("base64url"),
      "x-tax-tenant-signature": "f".repeat(64),
    };
    const invalidPairs = [
      {
        ...forwardedSnapshotPrincipal(),
        "x-tax-tenant-principal": "not+base64url",
      },
      {
        ...forwardedSnapshotPrincipal(),
        "x-tax-tenant-signature": "F".repeat(64),
      },
      nonCanonical,
      forwardedSnapshotPrincipal(
        input.workspaceId,
        input.actorId,
        new Date(Date.now() + 600_000).toISOString(),
      ),
      forwardedSnapshotPrincipal(
        input.workspaceId,
        input.actorId,
        new Date(Date.now() - 1_000).toISOString(),
      ),
    ];

    for (const pair of invalidPairs) {
      await expect(
        client.getBrowserSnapshot(input.workspaceId, input.actorId, pair),
      ).rejects.toThrow("TAX_SNAPSHOT_PRINCIPAL_INVALID");
    }
    expect(requestCount).toBe(0);
  });

  test("rejects browser snapshot principals bound to another workspace or actor", async () => {
    let requestCount = 0;
    const client = new TaxAutomationClient({
      baseUrl: "https://tax.test",
      agentApiKey: "agent-key-at-least-sixteen",
      agentPrincipalSecret: "open-agents-tax-agent-principal-secret-32",
      fetchImpl: async () => {
        requestCount += 1;
        return response({});
      },
    });
    const mismatchedPrincipals = [
      forwardedSnapshotPrincipal(
        "99999999-9999-4999-8999-999999999999",
        input.actorId,
      ),
      forwardedSnapshotPrincipal(input.workspaceId, "user:another"),
    ];

    for (const principal of mismatchedPrincipals) {
      await expect(
        client.getBrowserSnapshot(input.workspaceId, input.actorId, principal),
      ).rejects.toThrow("TAX_SNAPSHOT_PRINCIPAL_SCOPE_MISMATCH");
    }
    expect(requestCount).toBe(0);
  });

  test("fails closed on malformed, unknown, or HTTP-inconsistent browser wire data", async () => {
    const unknownWire = {
      ok: true,
      data: {
        ...argentinaTaxWidgetSnapshotReceiptV1Fixture,
        version: "tax-browser-snapshot-receipt-v2",
      },
    };
    const unexpectedField = {
      ok: true,
      data: {
        ...argentinaTaxWidgetSnapshotReceiptV1Fixture,
        unexpected: true,
      },
    };
    const legacyWrapper = {
      data: argentinaTaxWidgetSnapshotReceiptV1Fixture,
    };
    const successWithWrongProjection = {
      ok: true,
      data: argentinaTaxWidgetSnapshotReceiptV1Fixture,
    };
    const stale = buildTaxSnapshotProblemV1("TAX_SNAPSHOT_STALE");
    const cases = [
      { status: 200, body: unknownWire, projectionKey: "annual:2026" },
      { status: 200, body: unexpectedField, projectionKey: "annual:2026" },
      { status: 200, body: legacyWrapper, projectionKey: "annual:2026" },
      {
        status: 200,
        body: successWithWrongProjection,
        projectionKey: "monthly:2026-07",
      },
      {
        status: 404,
        body: { ok: false, problem: stale },
        projectionKey: "annual:2026",
      },
      {
        status: 200,
        body: { ok: false, problem: stale },
        projectionKey: "annual:2026",
      },
    ];

    for (const invalid of cases) {
      const client = new TaxAutomationClient({
        baseUrl: "https://tax.test",
        agentApiKey: "agent-key-at-least-sixteen",
        agentPrincipalSecret: "open-agents-tax-agent-principal-secret-32",
        fetchImpl: async () => response(invalid.body, invalid.status),
      });
      await expect(
        client.getBrowserSnapshot(
          input.workspaceId,
          input.actorId,
          forwardedSnapshotPrincipal(),
          invalid.projectionKey,
        ),
      ).rejects.toThrow("TAX_BROWSER_SNAPSHOT_RESPONSE_INVALID");
    }
  });

  test("rejects a settlement mutation response for another run or workspace", async () => {
    const mismatches = [
      run({ runId: "10000000-0000-4000-8000-000000000099" }),
      run({ workspaceId: "99999999-9999-4999-8999-999999999999" }),
    ];
    for (const mismatchedRun of mismatches) {
      const client = new TaxAutomationClient({
        baseUrl: "https://tax.test",
        agentApiKey: "agent-key-at-least-sixteen",
        agentPrincipalSecret: "open-agents-tax-agent-principal-secret-32",
        fetchImpl: async () =>
          response({ data: { run: mismatchedRun, replayed: false } }),
      });
      await expect(
        client.recordInvoiceSettlement(runId, settlementEvent),
      ).rejects.toThrow("TAX_AUTOMATION_RESPONSE_IDENTITY_MISMATCH");
    }
  });

  test("advances deterministically through approval, authority, settlement, and accounting states", async () => {
    let state = run({ readinessState: "verified", revision: 3 });
    const client = new TaxAutomationClient({
      baseUrl: "https://tax.test",
      agentApiKey: "agent-key-at-least-sixteen",
      agentPrincipalSecret: "open-agents-tax-agent-principal-secret-32",
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
      phase: "settlement_pending",
      terminal: false,
      handoff: { accountingHandoff: { requiresApproval: true } },
    });
    state = run({
      readinessState: "verified",
      intentState: "frozen",
      approvalState: "user_approved",
      issuanceState: "arca_authorized",
      settlementState: "final",
      intentHash: "c".repeat(64),
      revision: 8,
    });
    expect(await advanceTaxInvoiceCase(client, input, runId)).toMatchObject({
      phase: "fx_ingress_review_required",
      terminal: false,
    });
    state = run({
      readinessState: "verified",
      intentState: "frozen",
      approvalState: "user_approved",
      issuanceState: "arca_authorized",
      settlementState: "final",
      fxIngressState: "verified",
      taxDeclarationState: "ready_for_accountant",
      intentHash: "c".repeat(64),
      revision: 9,
    });
    expect(await advanceTaxInvoiceCase(client, input, runId)).toMatchObject({
      phase: "tax_declaration_review_required",
      terminal: false,
    });
    state = run({
      readinessState: "verified",
      intentState: "frozen",
      approvalState: "user_approved",
      issuanceState: "arca_authorized",
      settlementState: "final",
      fxIngressState: "verified",
      taxDeclarationState: "declared",
      financeEligibility: "reviewable",
      intentHash: "c".repeat(64),
      revision: 10,
    });
    expect(await advanceTaxInvoiceCase(client, input, runId)).toMatchObject({
      phase: "accounting_ready",
      terminal: true,
      handoff: { accountingHandoff: { requiresApproval: true } },
    });
  });

  test("never treats a reversed or disputed settlement as completed", async () => {
    let state = run({
      readinessState: "verified",
      intentState: "frozen",
      approvalState: "user_approved",
      issuanceState: "arca_authorized",
      settlementState: "reversed",
      fxIngressState: "verified",
      taxDeclarationState: "declared",
      intentHash: "d".repeat(64),
      revision: 11,
    });
    const client = new TaxAutomationClient({
      baseUrl: "https://tax.test",
      agentApiKey: "agent-key-at-least-sixteen",
      agentPrincipalSecret: "open-agents-tax-agent-principal-secret-32",
      fetchImpl: async (url) => {
        const path = new URL(String(url)).pathname;
        if (path === `/v1/agent/runs/${runId}`)
          return response({ data: state, nextActions: ["review_reversal"] });
        if (
          path.endsWith(
            "tax_ar_factura_e_get_accounting_attestation_packet/invoke",
          )
        )
          return response({
            data: { accountingHandoff: { requiresApproval: true } },
          });
        throw new Error(`unexpected ${path}`);
      },
    });

    expect(await advanceTaxInvoiceCase(client, input, runId)).toMatchObject({
      phase: "settlement_attention_required",
      terminal: false,
    });
    state = { ...state, settlementState: "disputed", revision: 12 };
    expect(await advanceTaxInvoiceCase(client, input, runId)).toMatchObject({
      phase: "settlement_attention_required",
      terminal: false,
    });
  });

  test("rejects insecure provider URLs and never accepts authority credentials", () => {
    expect(
      () =>
        new TaxAutomationClient({
          baseUrl: "http://tax.example.com",
          agentApiKey: "agent-key-at-least-sixteen",
          agentPrincipalSecret: "open-agents-tax-agent-principal-secret-32",
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
