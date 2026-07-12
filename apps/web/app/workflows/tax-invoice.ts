import {
  TaxAutomationClient,
  TaxInvoiceDispatchSchema,
  advanceTaxInvoiceCase,
  prepareTaxInvoiceCase,
  taxRunIdFor,
  type TaxInvoiceCheckpoint,
  type TaxInvoiceDispatch,
} from "@open-agents/tax-automation";
import {
  buildEvidenceReport,
  validateArgentinaExport,
  type TaxEvidenceReport,
} from "@open-agents/tax-agent";
import { getWorkflowMetadata, sleep } from "workflow";
import {
  appendOperatingPackTrace,
  attachOperatingPackWorkflowRun,
  updateOperatingPackRun,
} from "@/lib/db/operating-pack-runs";

export type TaxInvoiceWorkflowInput = Readonly<{
  executionId: string;
  dispatch: TaxInvoiceDispatch;
}>;

async function evidenceSpecialistStep(
  input: TaxInvoiceWorkflowInput,
): Promise<TaxEvidenceReport> {
  "use step";
  const dispatch = TaxInvoiceDispatchSchema.parse(input.dispatch);
  // The engine will append this same source as accepted evidence. The
  // specialist returns only a hash-bound reference; connector/ERP evidence is
  // joined by the engine from its canonical workspace graph.
  return buildEvidenceReport(dispatch, [
    {
      evidenceId: `bufi-invoice:${dispatch.invoice.invoiceId}`,
      sourceKind: "bufi_invoice",
      evidenceHash: dispatch.invoice.artifactHash,
      economicEventId: dispatch.invoice.economicEventId,
      period: {
        start: dispatch.invoice.issueDate,
        end: dispatch.invoice.paymentDate,
      },
      observedAt: dispatch.invoice.observedAt,
      freshness: "fresh",
      confidence: 1,
      consentVersion: dispatch.invoice.consentVersion,
      accountantReviewStatus: "pending",
    },
  ]);
}

async function jurisdictionSpecialistStep(input: TaxInvoiceWorkflowInput) {
  "use step";
  return validateArgentinaExport(
    TaxInvoiceDispatchSchema.parse(input.dispatch),
  );
}

async function accountingSpecialistStep(input: TaxInvoiceWorkflowInput) {
  "use step";
  const dispatch = TaxInvoiceDispatchSchema.parse(input.dispatch);
  return {
    version: "tax-accounting-context-v1" as const,
    workspaceId: dispatch.workspaceId,
    economicEventId: dispatch.invoice.economicEventId,
    providers: ["quickbooks", "xero", "contaazul", "contabilium"] as const,
    writes: false as const,
    source: "workspace-accounting-connectors" as const,
    period: {
      start: dispatch.invoice.issueDate,
      end: dispatch.invoice.paymentDate,
    },
    freshness: "fresh" as const,
    confidence: 1 as const,
    consentScope: dispatch.invoice.consentVersion,
    evidenceHash: dispatch.invoice.sourceEventHash,
    accountantReviewStatus: "pending" as const,
  };
}

async function persistFanoutStep(
  input: TaxInvoiceWorkflowInput,
  evidence: TaxEvidenceReport,
  jurisdiction: ReturnType<typeof validateArgentinaExport>,
  accounting: Awaited<ReturnType<typeof accountingSpecialistStep>>,
): Promise<void> {
  "use step";
  await appendOperatingPackTrace({
    id: `${input.executionId}:2`,
    runId: input.executionId,
    workspaceId: input.dispatch.workspaceId,
    sequence: 2,
    type: "specialists.joined",
    agentId: "tax_automation:tax_orchestrator",
    summary: "Tax evidence and jurisdiction specialists joined",
    data: {
      evidenceRoot: evidence.evidenceRoot,
      evidenceCount: evidence.references.length,
      missingEvidence: evidence.missing,
      accountantReviewStatus: evidence.accountantReviewStatus,
      jurisdiction: jurisdiction.jurisdiction,
      regime: jurisdiction.regime,
      accountingProviders: accounting.providers,
      accountingWrites: accounting.writes,
    },
  });
}

function client(): TaxAutomationClient {
  return new TaxAutomationClient({
    baseUrl: process.env.TAX_AUTOMATION_ENGINE_URL ?? "",
    agentApiKey: process.env.TAX_AUTOMATION_ENGINE_API_KEY ?? "",
    evidenceIngestToken: process.env.TAX_AUTOMATION_EVIDENCE_INGEST_TOKEN ?? "",
  });
}

function traceSequence(checkpoint: TaxInvoiceCheckpoint): number {
  return Math.min(
    900_000,
    100 + checkpoint.revision * 10 + phaseOrdinal(checkpoint.phase),
  );
}

function phaseOrdinal(phase: TaxInvoiceCheckpoint["phase"]): number {
  return (
    [
      "readiness_interaction_required",
      "readiness_pending",
      "approval_required",
      "accountant_approval_required",
      "manual_arca_issuance_required",
      "wsfex_submission_required",
      "authority_pending",
      "authorized",
      "settlement_pending",
      "settlement_attention_required",
      "fx_ingress_review_required",
      "tax_declaration_review_required",
      "accounting_ready",
      "rejected",
      "blocked",
    ].indexOf(phase) + 1
  );
}

function checkpointTraceType(phase: TaxInvoiceCheckpoint["phase"]): string {
  if (phase === "authorized") return "authority.verified";
  if (phase === "settlement_pending") return "settlement.pending";
  if (phase === "settlement_attention_required")
    return "settlement.attention_required";
  if (phase === "fx_ingress_review_required") return "fx.review_required";
  if (phase === "tax_declaration_review_required") return "tax.review_required";
  if (phase === "accounting_ready") return "accounting.ready";
  if (phase.includes("approval")) return "approval.requested";
  return "workflow.checkpoint";
}

async function markStartedStep(
  input: TaxInvoiceWorkflowInput,
  workflowRunId: string,
) {
  "use step";
  await Promise.all([
    attachOperatingPackWorkflowRun(input.executionId, workflowRunId),
    updateOperatingPackRun(input.executionId, { status: "running" }),
    appendOperatingPackTrace({
      id: `${input.executionId}:1`,
      runId: input.executionId,
      workspaceId: input.dispatch.workspaceId,
      sequence: 1,
      type: "workflow.started",
      agentId: "tax_automation:tax_orchestrator",
      summary: "AI invoice to Factura E workflow started",
      data: {
        invoiceId: input.dispatch.invoice.invoiceId,
        issuancePath: input.dispatch.issuancePath,
      },
    }),
  ]);
}

async function prepareStep(
  input: TaxInvoiceWorkflowInput,
): Promise<TaxInvoiceCheckpoint> {
  "use step";
  const dispatch = TaxInvoiceDispatchSchema.parse(input.dispatch);
  return prepareTaxInvoiceCase(
    client(),
    dispatch,
    taxRunIdFor(dispatch.workspaceId, dispatch.idempotencyKey),
  );
}

async function advanceStep(
  input: TaxInvoiceWorkflowInput,
): Promise<TaxInvoiceCheckpoint> {
  "use step";
  const dispatch = TaxInvoiceDispatchSchema.parse(input.dispatch);
  return advanceTaxInvoiceCase(
    client(),
    dispatch,
    taxRunIdFor(dispatch.workspaceId, dispatch.idempotencyKey),
  );
}

async function persistCheckpointStep(
  input: TaxInvoiceWorkflowInput,
  checkpoint: TaxInvoiceCheckpoint,
): Promise<void> {
  "use step";
  const status = checkpoint.terminal
    ? checkpoint.phase === "accounting_ready"
      ? "completed"
      : checkpoint.phase === "rejected"
        ? "rejected"
        : "failed"
    : [
          "approval_required",
          "accountant_approval_required",
          "manual_arca_issuance_required",
          "readiness_interaction_required",
          "settlement_attention_required",
          "fx_ingress_review_required",
          "tax_declaration_review_required",
        ].includes(checkpoint.phase)
      ? "awaiting_approval"
      : "running";
  const result = {
    version: "tax-invoice-workflow-result-v1",
    taxRunId: checkpoint.taxRunId,
    phase: checkpoint.phase,
    intentHash: checkpoint.intentHash,
    nextActions: checkpoint.nextActions,
    handoff: checkpoint.handoff,
    revision: checkpoint.revision,
    approvalBoundary: "tax-engine-trusted-channel",
  } as const;
  await Promise.all([
    updateOperatingPackRun(input.executionId, {
      status,
      approvalId: null,
      result,
      ...(checkpoint.terminal ? { finished: true } : {}),
      ...(checkpoint.phase === "blocked"
        ? { errorCode: "TAX_ENGINE_BLOCKED" }
        : {}),
    }),
    appendOperatingPackTrace({
      id: `${input.executionId}:${traceSequence(checkpoint)}`,
      runId: input.executionId,
      workspaceId: input.dispatch.workspaceId,
      sequence: traceSequence(checkpoint),
      type: checkpointTraceType(checkpoint.phase),
      agentId: "tax_automation:tax_orchestrator",
      summary: `Tax invoice phase: ${checkpoint.phase}`,
      data: {
        taxRunId: checkpoint.taxRunId,
        intentHash: checkpoint.intentHash,
        revision: checkpoint.revision,
        nextActions: checkpoint.nextActions,
      },
    }),
  ]);
}

async function failStep(
  input: TaxInvoiceWorkflowInput,
  errorCode: string,
): Promise<void> {
  "use step";
  await Promise.all([
    updateOperatingPackRun(input.executionId, {
      status: "failed",
      errorCode,
      finished: true,
    }),
    appendOperatingPackTrace({
      id: `${input.executionId}:999999`,
      runId: input.executionId,
      workspaceId: input.dispatch.workspaceId,
      sequence: 999_999,
      type: "run.failed",
      summary: `Tax invoice workflow failed: ${errorCode}`,
    }),
  ]);
}

export async function runTaxInvoiceWorkflow(input: TaxInvoiceWorkflowInput) {
  "use workflow";
  const { workflowRunId } = getWorkflowMetadata();
  await markStartedStep(input, workflowRunId);
  try {
    const [evidence, jurisdiction, accounting] = await Promise.all([
      evidenceSpecialistStep(input),
      jurisdictionSpecialistStep(input),
      accountingSpecialistStep(input),
    ]);
    await persistFanoutStep(input, evidence, jurisdiction, accounting);
    let checkpoint = await prepareStep(input);
    await persistCheckpointStep(input, checkpoint);
    for (let poll = 0; poll < 487 && !checkpoint.terminal; poll += 1) {
      // Keep Reclaim and authority interactions feeling immediate, back off
      // across the first day, then durably monitor settlement/accounting for
      // up to one year without holding a process or credential in memory.
      await sleep(poll < 30 ? "2m" : poll < 122 ? "15m" : "1d");
      checkpoint = await advanceStep(input);
      await persistCheckpointStep(input, checkpoint);
    }
    if (!checkpoint.terminal) {
      await failStep(input, "TAX_EXTERNAL_INTERACTION_TIMEOUT");
      return {
        status: "failed" as const,
        errorCode: "TAX_EXTERNAL_INTERACTION_TIMEOUT",
      };
    }
    return {
      status:
        checkpoint.phase === "accounting_ready"
          ? ("completed" as const)
          : ("failed" as const),
      checkpoint,
    };
  } catch (error) {
    await failStep(input, "TAX_AUTOMATION_EXECUTION_FAILED");
    throw error;
  }
}
