import {
  TaxAutomationClient,
  TaxInvoiceDispatchSchema,
  advanceTaxInvoiceCase,
  prepareTaxInvoiceCase,
  taxRunIdFor,
  type TaxInvoiceCheckpoint,
  type TaxInvoiceDispatch,
} from "@open-agents/tax-automation";
import { createHook, getWorkflowMetadata, sleep } from "workflow";
import {
  appendOperatingPackTrace,
  attachOperatingPackWorkflowRun,
  updateOperatingPackRun,
} from "@/lib/db/operating-pack-runs";
import {
  countCompletedTaxSettlementDeliveries,
  listPendingTaxSettlementDeliveries,
} from "@/lib/db/tax-settlements";
import {
  deliverTaxSettlement,
  TaxSettlementDeliveryError,
} from "@/lib/operating-packs/tax-settlement-delivery";
import { getTaxSettlementHookToken } from "@/lib/operating-packs/tax-settlement-hook";
import { drainPendingTaxSettlementDeliveries } from "@/lib/operating-packs/tax-settlement-processing";

export type TaxInvoiceWorkflowInput = Readonly<{
  executionId: string;
  dispatch: TaxInvoiceDispatch;
}>;

function client(): TaxAutomationClient {
  return new TaxAutomationClient({
    baseUrl: process.env.TAX_AUTOMATION_ENGINE_URL ?? "",
    agentApiKey: process.env.TAX_AUTOMATION_ENGINE_API_KEY ?? "",
    agentPrincipalSecret:
      process.env.TAX_AUTOMATION_ENGINE_AGENT_PRINCIPAL_HMAC_SECRET ?? "",
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
        ledgerInvoiceId: input.dispatch.invoice.ledgerInvoiceId,
        artifactId: input.dispatch.invoice.artifactId,
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

async function flushPendingSettlementsStep(
  input: TaxInvoiceWorkflowInput,
  taxRunId: string,
): Promise<number> {
  "use step";
  return drainPendingTaxSettlementDeliveries({
    listPending: () => listPendingTaxSettlementDeliveries(input.executionId),
    deliver: async (delivery) => {
      try {
        return await deliverTaxSettlement({
          event: delivery.payload,
          binding: { operatingPackRunId: input.executionId, taxRunId },
        });
      } catch (error) {
        if (error instanceof TaxSettlementDeliveryError && !error.retryable)
          return { status: "waiting_for_case" as const };
        throw error;
      }
    },
  });
}

async function completedSettlementCountStep(
  executionId: string,
): Promise<number> {
  "use step";
  return countCompletedTaxSettlementDeliveries(executionId);
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
    taxpayerReferenceHash: checkpoint.taxpayerReferenceHash,
    foreignCustomerReferenceHash: checkpoint.foreignCustomerReferenceHash,
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
        taxpayerReferenceHash: checkpoint.taxpayerReferenceHash,
        foreignCustomerReferenceHash: checkpoint.foreignCustomerReferenceHash,
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
    let completedSettlementCount = await completedSettlementCountStep(
      input.executionId,
    );
    for (let poll = 0; poll < 487 && !checkpoint.terminal; poll += 1) {
      completedSettlementCount = await waitForTaxProgress(
        input.executionId,
        checkpoint.phase,
        poll,
        completedSettlementCount,
      );
      checkpoint = await advanceStep(input);
      if ((await flushPendingSettlementsStep(input, checkpoint.taxRunId)) > 0)
        checkpoint = await advanceStep(input);
      await persistCheckpointStep(input, checkpoint);
      completedSettlementCount = await completedSettlementCountStep(
        input.executionId,
      );
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

async function waitForTaxProgress(
  executionId: string,
  phase: TaxInvoiceCheckpoint["phase"],
  poll: number,
  completedSettlementCount: number,
): Promise<number> {
  const hook = createHook<{ eventId: string }>({
    token: getTaxSettlementHookToken(executionId),
  });
  try {
    const latestCount = await completedSettlementCountStep(executionId);
    if (latestCount > completedSettlementCount) return latestCount;
    const fallback =
      phase === "settlement_pending" ||
      phase === "settlement_attention_required"
        ? "1d"
        : poll < 30
          ? "2m"
          : poll < 122
            ? "15m"
            : "1d";
    await Promise.race([hook, sleep(fallback)]);
    return completedSettlementCountStep(executionId);
  } finally {
    hook.dispose();
  }
}
