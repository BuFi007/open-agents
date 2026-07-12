import { describe, expect, it } from "bun:test";
import {
  buildEvidenceReport,
  createTaxAgentWorkflow,
  runTaxAgentWorkflow,
  type TaxEvidenceReference,
} from "./index";
import type { TaxInvoiceDispatch } from "@open-agents/tax-automation";

const dispatch: TaxInvoiceDispatch = {
  workspaceId: "11111111-1111-4111-8111-111111111111",
  actorId: "agent:tax",
  idempotencyKey: "tax-agent:workflow-1",
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
    serviceDescription: "Software services",
    paymentTerms: "Due on receipt",
    unitCode: 7,
    observedAt: "2026-07-11T12:00:00.000Z",
  },
};

const evidence = (
  id: string,
  sourceKind: TaxEvidenceReference["sourceKind"],
): TaxEvidenceReference => ({
  evidenceId: id,
  sourceKind,
  evidenceHash: "a".repeat(64),
  economicEventId: dispatch.invoice.economicEventId,
  period: { start: "2026-07-11", end: "2026-07-11" },
  observedAt: "2026-07-11T12:00:00.000Z",
  freshness: "fresh",
  confidence: 1,
  consentVersion: "tax-consent-v1",
  accountantReviewStatus: "pending",
});

describe("Tax Agent specialist workflow", () => {
  it("joins only same-event evidence and marks candidate signals separately", () => {
    const report = buildEvidenceReport(dispatch, [
      evidence("accounting-1", "accounting"),
      evidence("analytics-1", "financial_analytics"),
      { ...evidence("other-event", "bank"), economicEventId: "other" },
    ]);
    expect(report.references).toHaveLength(2);
    expect(report.authoritativeSources).toEqual(["accounting"]);
    expect(report.candidateSources).toEqual(["financial_analytics"]);
    expect(report.missing).toContain("settlement_evidence");
    expect(report.evidenceRoot).toHaveLength(64);
  });

  it("defines a fan-out, deterministic join, approval gate and resume", () => {
    const definition = createTaxAgentWorkflow(
      {
        workspaceId: dispatch.workspaceId,
        dispatch,
      },
      {
        engine: {} as never,
        store: { append: async () => {}, save: async () => {} },
        evidenceReader: async () => [evidence("bank-1", "bank")],
      },
    );
    expect(definition.steps.map((step) => step.id)).toEqual([
      "tax_evidence",
      "tax_jurisdiction",
      "tax_accounting_context",
      "tax_engine_prepare",
      "tax_engine_checkpoint",
      "tax_human_gate",
      "tax_engine_resume",
    ]);
    expect(
      definition.steps.find((step) => step.id === "tax_engine_prepare")
        ?.dependsOn,
    ).toEqual(["tax_evidence", "tax_jurisdiction", "tax_accounting_context"]);
    expect(
      definition.steps.find((step) => step.id === "tax_human_gate")?.kind,
    ).toBe("approval");
  });

  it("pauses at the trusted approval gate and resumes without replaying specialists", async () => {
    const runs = new Map<string, any>();
    const events: unknown[] = [];
    const store = {
      async append(_runId: string, event: unknown) {
        events.push(event);
      },
      async save(run: any) {
        runs.set(run.runId, structuredClone(run));
      },
      async load(runId: string) {
        return runs.get(runId) ?? null;
      },
    };
    let prepareCalls = 0;
    let readCalls = 0;
    const engine = {
      async appendInvoiceEvidence() {},
      async createCase() {
        prepareCalls += 1;
        return {};
      },
      async startReadiness() {
        return {};
      },
      async getRun() {
        readCalls += 1;
        return {
          run: {
            runId: "10000000-0000-4000-8000-000000000001",
            workspaceId: dispatch.workspaceId,
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
          },
          nextActions: ["request_arca_readiness_proof"],
        };
      },
      async proposeFromEvidence() {},
      async requestApproval() {},
      async getCopilotPacket() {},
      async getAttestationPacket() {},
    };
    const fakeClient = engine as never;
    const input = {
      workspaceId: dispatch.workspaceId,
      dispatch,
      runId: "tax-workflow-1",
    };
    const first = await runTaxAgentWorkflow(input, {
      engine: fakeClient,
      store,
      evidenceReader: async () => [],
      resolveApproval: async () => "pending",
    });
    expect(first.workflow.status).toBe("paused");
    expect(first.evidence?.missing).toContain("accounting_entry");
    expect(prepareCalls).toBe(1);
    const second = await runTaxAgentWorkflow(input, {
      engine: fakeClient,
      store,
      evidenceReader: async () => {
        throw new Error("completed specialist must not replay");
      },
      resolveApproval: async () => "approved",
    });
    expect(second.workflow.status).toBe("completed");
    expect(second.checkpoints).toHaveLength(3);
    expect(readCalls).toBe(3);
    expect(events).toContainEqual(
      expect.objectContaining({ type: "approval.requested" }),
    );
  });
});
