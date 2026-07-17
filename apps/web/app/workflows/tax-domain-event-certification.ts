import { z } from "zod";
import { createHook, getWorkflowMetadata, sleep } from "workflow";

import {
  appendOperatingPackTrace,
  attachOperatingPackWorkflowRun,
  updateOperatingPackRun,
} from "@/lib/db/operating-pack-runs";
import {
  taxDomainEventCertificationResultSchema,
  type TaxDomainEventCertificationRefs,
} from "@/lib/operating-packs/tax-domain-event-certification";
import { getTaxWorkflowWakeHookToken } from "@/lib/operating-packs/tax-settlement-hook";

export type TaxDomainEventCertificationWorkflowInput = Readonly<
  Pick<TaxDomainEventCertificationRefs, "workspaceRef" | "caseRef" | "runRef">
>;

async function markCertificationStarted(
  input: TaxDomainEventCertificationWorkflowInput,
  workflowRunId: string,
): Promise<void> {
  "use step";
  await Promise.all([
    attachOperatingPackWorkflowRun(input.runRef, workflowRunId),
    updateOperatingPackRun(input.runRef, {
      status: "running",
      errorCode: null,
    }),
    appendOperatingPackTrace({
      id: `${input.runRef}:100`,
      runId: input.runRef,
      workspaceId: input.workspaceRef,
      sequence: 100,
      type: "certification.waiting",
      agentId: "bufi-tax",
      summary: "Waiting for a persisted TaxDomainEventV1 wake",
      data: {
        caseRef: input.caseRef,
        boundary: "tax-domain-event-v1",
      },
    }),
  ]);
}

async function completeCertification(
  input: TaxDomainEventCertificationWorkflowInput,
  eventIdInput: string,
) {
  "use step";
  const result = taxDomainEventCertificationResultSchema.parse({
    version: "tax-domain-event-certification-result-v1",
    eventId: z.uuid().parse(eventIdInput),
    proof: "durable_tax_domain_event_wake",
  });
  await Promise.all([
    updateOperatingPackRun(input.runRef, {
      status: "completed",
      result,
      errorCode: null,
      finished: true,
    }),
    appendOperatingPackTrace({
      id: `${input.runRef}:200`,
      runId: input.runRef,
      workspaceId: input.workspaceRef,
      sequence: 200,
      type: "certification.completed",
      agentId: "bufi-tax",
      summary: "Durable TaxDomainEventV1 wake certified",
      data: {
        eventId: result.eventId,
        proof: result.proof,
      },
    }),
  ]);
  return result;
}

async function failCertification(
  input: TaxDomainEventCertificationWorkflowInput,
): Promise<void> {
  "use step";
  await Promise.all([
    updateOperatingPackRun(input.runRef, {
      status: "failed",
      errorCode: "TAX_DOMAIN_EVENT_CERTIFICATION_TIMEOUT",
      finished: true,
    }),
    appendOperatingPackTrace({
      id: `${input.runRef}:999`,
      runId: input.runRef,
      workspaceId: input.workspaceRef,
      sequence: 999,
      type: "certification.failed",
      agentId: "bufi-tax",
      summary: "TaxDomainEventV1 certification timed out",
    }),
  ]);
}

/**
 * Preview/local certification uses the same durable hook as every production
 * TaxCase. It proves persistence and workflow wake-up without invoking an
 * authority, provider, model, or customer workspace.
 */
export async function runTaxDomainEventCertificationWorkflow(
  input: TaxDomainEventCertificationWorkflowInput,
) {
  "use workflow";
  const { workflowRunId } = getWorkflowMetadata();
  await markCertificationStarted(input, workflowRunId);
  const hook = createHook<{ eventId: string }>({
    token: getTaxWorkflowWakeHookToken(input.runRef),
  });
  try {
    const wake = await Promise.race([
      hook.then((event) => ({ type: "event" as const, event })),
      sleep("10m").then(() => ({ type: "timeout" as const })),
    ]);
    if (wake.type === "timeout") {
      await failCertification(input);
      return {
        status: "failed" as const,
        errorCode: "TAX_DOMAIN_EVENT_CERTIFICATION_TIMEOUT" as const,
      };
    }
    const result = await completeCertification(input, wake.event.eventId);
    return { status: "completed" as const, result };
  } finally {
    hook.dispose();
  }
}
