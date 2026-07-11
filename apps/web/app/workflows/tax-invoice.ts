import {
  TaxAutomationClient,
  TaxInvoiceDispatchSchema,
  advanceTaxInvoiceCase,
  prepareTaxInvoiceCase,
  taxRunIdFor,
  type TaxInvoiceCheckpoint,
  type TaxInvoiceDispatch,
} from "@open-agents/tax-automation";
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
      "rejected",
      "blocked",
    ].indexOf(phase) + 1
  );
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
    ? checkpoint.phase === "authorized"
      ? "completed"
      : checkpoint.phase === "rejected"
        ? "rejected"
        : "failed"
    : [
          "approval_required",
          "accountant_approval_required",
          "manual_arca_issuance_required",
          "readiness_interaction_required",
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
      type:
        checkpoint.phase === "authorized"
          ? "authority.verified"
          : checkpoint.phase.includes("approval")
            ? "approval.requested"
            : "workflow.checkpoint",
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
    let checkpoint = await prepareStep(input);
    await persistCheckpointStep(input, checkpoint);
    for (let poll = 0; poll < 672 && !checkpoint.terminal; poll += 1) {
      // Keep the first human/Reclaim interactions feeling immediate, then
      // back off for long-lived accountant or authority waits.
      await sleep(poll < 30 ? "2m" : "15m");
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
        checkpoint.phase === "authorized"
          ? ("completed" as const)
          : ("failed" as const),
      checkpoint,
    };
  } catch (error) {
    await failStep(input, "TAX_AUTOMATION_EXECUTION_FAILED");
    throw error;
  }
}
