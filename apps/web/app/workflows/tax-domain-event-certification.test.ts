import { beforeEach, describe, expect, mock, test } from "bun:test";

const eventId = "20000000-0000-4000-8000-000000000001";
let mode: "event" | "timeout" = "event";
let disposed = 0;
const updates: Array<Record<string, unknown>> = [];
const traces: Array<Record<string, unknown>> = [];

mock.module("workflow", () => ({
  getWorkflowMetadata: () => ({ workflowRunId: "workflow_certification_1" }),
  createHook: () => {
    const promise =
      mode === "event"
        ? Promise.resolve({ eventId })
        : new Promise<{ eventId: string }>(() => undefined);
    return Object.assign(promise, {
      dispose: () => {
        disposed += 1;
      },
    });
  },
  sleep: () =>
    mode === "timeout" ? Promise.resolve() : new Promise<void>(() => undefined),
}));

mock.module("@/lib/db/operating-pack-runs", () => ({
  attachOperatingPackWorkflowRun: async (
    runRef: string,
    workflowRunId: string,
  ) => updates.push({ runRef, workflowRunId }),
  updateOperatingPackRun: async (
    runRef: string,
    input: Record<string, unknown>,
  ) => updates.push({ runRef, ...input }),
  appendOperatingPackTrace: async (input: Record<string, unknown>) => {
    traces.push(input);
  },
}));

mock.module("@/lib/operating-packs/tax-settlement-hook", () => ({
  getTaxWorkflowWakeHookToken: (runRef: string) => `hook:${runRef}`,
}));

const { runTaxDomainEventCertificationWorkflow } =
  await import("./tax-domain-event-certification");

const input = {
  workspaceRef: "10000000-0000-4000-8000-000000000001",
  caseRef: "taxcase_e2e_opaque",
  runRef: "taxcert_opaque",
};

beforeEach(() => {
  mode = "event";
  disposed = 0;
  updates.length = 0;
  traces.length = 0;
});

describe("TaxDomainEventV1 certification workflow", () => {
  test("completes only after a UUID event wakes the canonical hook", async () => {
    await expect(
      runTaxDomainEventCertificationWorkflow(input),
    ).resolves.toEqual({
      status: "completed",
      result: {
        version: "tax-domain-event-certification-result-v1",
        eventId,
        proof: "durable_tax_domain_event_wake",
      },
    });
    expect(updates).toContainEqual({
      runRef: input.runRef,
      status: "completed",
      result: {
        version: "tax-domain-event-certification-result-v1",
        eventId,
        proof: "durable_tax_domain_event_wake",
      },
      errorCode: null,
      finished: true,
    });
    expect(traces.map((trace) => trace.type)).toEqual([
      "certification.waiting",
      "certification.completed",
    ]);
    expect(disposed).toBe(1);
  });

  test("fails durably when no event arrives", async () => {
    mode = "timeout";
    await expect(
      runTaxDomainEventCertificationWorkflow(input),
    ).resolves.toEqual({
      status: "failed",
      errorCode: "TAX_DOMAIN_EVENT_CERTIFICATION_TIMEOUT",
    });
    expect(updates).toContainEqual({
      runRef: input.runRef,
      status: "failed",
      errorCode: "TAX_DOMAIN_EVENT_CERTIFICATION_TIMEOUT",
      finished: true,
    });
    expect(disposed).toBe(1);
  });
});
