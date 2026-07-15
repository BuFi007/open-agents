import { randomUUID } from "node:crypto";
import {
  type InvoiceSettlementEventV1,
  TaxAutomationClient,
} from "@open-agents/tax-automation";
import {
  appendOperatingPackTraceNext,
  getOperatingPackRun,
  updateOperatingPackRun,
} from "@/lib/db/operating-pack-runs";
import {
  acquireTaxSettlementProcessing,
  listDependentTaxSettlementDeliveries,
  markTaxSettlementCompleted,
  markTaxSettlementFailed,
  markTaxSettlementWaiting,
} from "@/lib/db/tax-settlements";
import { concurrentTaxSettlementOutcome } from "@/lib/operating-packs/tax-settlement-processing";

const prerequisiteCodes = new Set([
  "AGENT_RUN_NOT_FOUND",
  "INVOICE_INTENT_REQUIRED",
  "REVERSED_SETTLEMENT_NOT_FOUND",
]);

export type TaxSettlementBinding = Readonly<{
  operatingPackRunId: string;
  taxRunId: string;
}>;

export type TaxSettlementDeliveryResult =
  | Readonly<{
      status: "completed";
      replayed: boolean;
      taxRevision: number | null;
    }>
  | Readonly<{ status: "processing" }>
  | Readonly<{ status: "waiting_for_case"; reason: string }>;

export class TaxSettlementDeliveryError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, retryable: boolean) {
    super(`Tax settlement delivery failed: ${code}`);
    this.name = "TaxSettlementDeliveryError";
    this.code = code;
    this.retryable = retryable;
  }
}

export async function deliverTaxSettlement(input: {
  event: InvoiceSettlementEventV1;
  binding: TaxSettlementBinding;
}): Promise<TaxSettlementDeliveryResult> {
  const processingToken = randomUUID();
  const acquisition = await acquireTaxSettlementProcessing({
    eventId: input.event.eventId,
    operatingPackRunId: input.binding.operatingPackRunId,
    taxRunId: input.binding.taxRunId,
    processingToken,
  });
  if (acquisition.state === "completed")
    return { status: "completed", replayed: true, taxRevision: null };
  if (acquisition.state === "processing") return { status: "processing" };
  try {
    const result = await client().recordInvoiceSettlement(
      input.binding.taxRunId,
      input.event,
    );
    await appendDeliveryTrace(input, result.replayed, result.run.revision);
    if (input.event.eventType === "InvoiceSettlementReversedV1")
      await reopenRunForReversal(input, result.run.revision);
    const completed = await markTaxSettlementCompleted(
      input.event.eventId,
      processingToken,
    );
    const concurrentCompletion = concurrentTaxSettlementOutcome(
      completed.status,
      "completed",
    );
    if (concurrentCompletion) return concurrentCompletion;
    if (completed.status !== "completed")
      throw new Error(
        "Tax Automation Engine request failed: TAX_SETTLEMENT_STATE_TRANSITION_CONFLICT",
      );
    return {
      status: "completed",
      replayed: result.replayed,
      taxRevision: result.run.revision,
    };
  } catch (error) {
    const code = taxErrorCode(error);
    if (prerequisiteCodes.has(code)) {
      const waiting = await markTaxSettlementWaiting(
        input.event.eventId,
        processingToken,
        code,
      );
      const concurrentWaiting = concurrentTaxSettlementOutcome(
        waiting.status,
        "waiting_for_case",
      );
      if (concurrentWaiting) return concurrentWaiting;
      return { status: "waiting_for_case", reason: code };
    }
    const failed = await markTaxSettlementFailed(
      input.event.eventId,
      processingToken,
      code,
    );
    const concurrentFailure = concurrentTaxSettlementOutcome(
      failed.status,
      "failed",
    );
    if (concurrentFailure) return concurrentFailure;
    throw new TaxSettlementDeliveryError(code, isRetryableTaxError(code));
  }
}

export async function deliverTaxSettlementDependents(input: {
  event: InvoiceSettlementEventV1;
  binding: TaxSettlementBinding;
}): Promise<number> {
  if (input.event.eventType !== "InvoiceSettlementFinalizedV1") return 0;
  const dependents = await listDependentTaxSettlementDeliveries({
    operatingPackRunId: input.binding.operatingPackRunId,
    workspaceId: input.event.teamId,
    ledgerInvoiceId: input.event.invoiceId,
    reversesEventId: input.event.eventId,
  });
  let completed = 0;
  for (const dependent of dependents) {
    const result = await deliverTaxSettlement({
      event: dependent.payload,
      binding: input.binding,
    });
    if (result.status === "completed") completed += 1;
  }
  return completed;
}

function client(): TaxAutomationClient {
  return new TaxAutomationClient({
    baseUrl: process.env.TAX_AUTOMATION_ENGINE_URL ?? "",
    agentApiKey: process.env.TAX_AUTOMATION_ENGINE_API_KEY ?? "",
  });
}

async function appendDeliveryTrace(
  input: {
    event: InvoiceSettlementEventV1;
    binding: TaxSettlementBinding;
  },
  replayed: boolean,
  taxRevision: number,
): Promise<void> {
  await appendOperatingPackTraceNext({
    id: `tax-settlement:${input.event.eventId}`,
    runId: input.binding.operatingPackRunId,
    workspaceId: input.event.teamId,
    type:
      input.event.eventType === "InvoiceSettlementReversedV1"
        ? "settlement.reversed"
        : "settlement.recorded",
    agentId: "tax_automation:tax_orchestrator",
    summary:
      input.event.eventType === "InvoiceSettlementReversedV1"
        ? "Verified invoice settlement reversal recorded"
        : "Verified invoice settlement recorded",
    data: {
      eventId: input.event.eventId,
      ledgerInvoiceId: input.event.invoiceId,
      allocationRevision: input.event.allocationRevision,
      projectionState: input.event.projection.state,
      evidenceHash: input.event.evidence.evidenceHash,
      taxRevision,
      replayed,
    },
  });
}

async function reopenRunForReversal(
  input: {
    event: InvoiceSettlementEventV1;
    binding: TaxSettlementBinding;
  },
  taxRevision: number,
): Promise<void> {
  const run = await getOperatingPackRun(input.binding.operatingPackRunId);
  if (!run) return;
  await updateOperatingPackRun(run.id, {
    status: "awaiting_approval",
    reopen: true,
    result: {
      ...run.result,
      phase: "settlement_attention_required",
      taxRunId: input.binding.taxRunId,
      settlementEventId: input.event.eventId,
      revision: taxRevision,
    },
  });
}

function taxErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/(?:request: |failed: )([A-Z][A-Z0-9_]{2,119})$/);
  if (match?.[1]) return match[1];
  if (message.includes("not configured"))
    return "TAX_AUTOMATION_NOT_CONFIGURED";
  if (message.includes("fetch") || message.includes("timeout"))
    return "TAX_AUTOMATION_UPSTREAM_UNAVAILABLE";
  return "TAX_AUTOMATION_DELIVERY_FAILED";
}

function isRetryableTaxError(code: string): boolean {
  return (
    code === "TAX_AUTOMATION_NOT_CONFIGURED" ||
    code === "TAX_AUTOMATION_UPSTREAM_UNAVAILABLE" ||
    code === "TAX_AUTOMATION_DELIVERY_FAILED" ||
    /^HTTP_5\d\d$/.test(code)
  );
}
