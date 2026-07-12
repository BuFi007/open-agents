import { createHash } from "node:crypto";
import {
  TaxInvoiceDispatchSchema,
  advanceTaxInvoiceCase,
  prepareTaxInvoiceCase,
  taxRunIdFor,
  type TaxAutomationClient,
  type TaxInvoiceCheckpoint,
  type TaxInvoiceDispatch,
} from "@open-agents/tax-automation";
import {
  createWorkflow,
  resumeWorkflow,
  runWorkflow,
  type ApprovalDecision,
  type WorkflowDefinition,
  type WorkflowRun,
  type WorkflowStore,
} from "@open-agents/workflow";
import { z } from "zod";

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const sourceKind = z.enum([
  "bufi_invoice",
  "accounting",
  "bank",
  "stripe",
  "wallet",
  "magic_inbox",
  "knowledge_graph",
  "transaction_enrichment",
  "financial_analytics",
]);

/** A metadata-only reference returned by a read-only workspace specialist. */
export const TaxEvidenceReferenceSchema = z
  .object({
    evidenceId: z.string().min(1).max(191),
    sourceKind,
    evidenceHash: sha256,
    economicEventId: z.string().min(1).max(191),
    period: z.object({ start: z.iso.date(), end: z.iso.date() }).strict(),
    observedAt: z.iso.datetime({ offset: true }),
    freshness: z.enum(["fresh", "stale", "expired", "unknown"]),
    confidence: z.number().min(0).max(1),
    consentVersion: z.string().min(1).max(191),
    accountantReviewStatus: z.enum([
      "not_required",
      "pending",
      "approved",
      "rejected",
    ]),
  })
  .strict();

export type TaxEvidenceReference = z.infer<typeof TaxEvidenceReferenceSchema>;

export const TaxEvidenceReportSchema = z
  .object({
    version: z.literal("tax-agent-evidence-report-v1"),
    workspaceId: z.string().uuid(),
    economicEventId: z.string().min(1).max(191),
    references: z.array(TaxEvidenceReferenceSchema),
    evidenceRoot: sha256,
    authoritativeSources: z.array(sourceKind),
    candidateSources: z.array(sourceKind),
    missing: z.array(z.string().min(1).max(160)),
    accountantReviewStatus: z.enum([
      "not_required",
      "pending",
      "approved",
      "rejected",
    ]),
  })
  .strict();

export type TaxEvidenceReport = z.infer<typeof TaxEvidenceReportSchema>;

export type TaxEvidenceReader = (input: {
  workspaceId: string;
  economicEventId: string;
  signal: AbortSignal;
}) => Promise<readonly TaxEvidenceReference[]>;

export type TaxAgentWorkflowInput = Readonly<{
  workspaceId: string;
  dispatch: TaxInvoiceDispatch;
  runId?: string;
}>;

export type TaxAgentWorkflowDependencies = Readonly<{
  engine: TaxAutomationClient;
  evidenceReader?: TaxEvidenceReader;
  store: WorkflowStore;
  resolveApproval?: (input: {
    workspaceId: string;
    workflowId: string;
    runId: string;
    stepId: string;
    approval: {
      approvalId: string;
      capability: string;
      summary: string;
      expiresAtMs?: number;
    };
  }) => Promise<ApprovalDecision>;
}>;

export type TaxAgentWorkflowResult = Readonly<{
  workflow: WorkflowRun;
  evidence: TaxEvidenceReport | null;
  checkpoints: readonly TaxInvoiceCheckpoint[];
}>;

/**
 * Builds the Tax Agent's specialist DAG. Specialists only return redacted
 * metadata. The external Tax Automation Engine remains the authority for tax
 * rules, ARCA state, approvals, receipts and accounting readiness.
 */
export function createTaxAgentWorkflow(
  input: TaxAgentWorkflowInput,
  dependencies: TaxAgentWorkflowDependencies,
): WorkflowDefinition<TaxAgentWorkflowInput> {
  const dispatch = TaxInvoiceDispatchSchema.parse(input.dispatch);
  if (input.workspaceId !== dispatch.workspaceId)
    throw new Error("Tax Agent workspace mismatch");

  const runId =
    input.runId ?? taxRunIdFor(dispatch.workspaceId, dispatch.idempotencyKey);
  return createWorkflow({
    id: "tax_automation.factura_e_agent",
    workspaceId: dispatch.workspaceId,
    input,
    budgetMs: 30_000,
    steps: [
      {
        id: "tax_evidence",
        agentId: "tax_automation:tax_evidence",
        maxAttempts: 2,
        retryBackoffMs: 50,
        run: async ({ signal }) => {
          const references = dependencies.evidenceReader
            ? await dependencies.evidenceReader({
                workspaceId: dispatch.workspaceId,
                economicEventId: dispatch.invoice.economicEventId,
                signal,
              })
            : [];
          return buildEvidenceReport(dispatch, references);
        },
      },
      {
        id: "tax_jurisdiction",
        agentId: "tax_automation:tax_jurisdiction",
        run: async () => validateArgentinaExport(dispatch),
      },
      {
        id: "tax_accounting_context",
        agentId: "tax_automation:tax_accounting",
        run: async ({ signal }) => {
          // This specialist deliberately does not write to an ERP. It is a
          // bounded readiness signal; the engine consumes accepted evidence.
          if (signal.aborted) throw signal.reason ?? new Error("cancelled");
          return {
            version: "tax-accounting-context-v1",
            workspaceId: dispatch.workspaceId,
            providers: ["quickbooks", "xero", "contaazul", "contabilium"],
            writes: false,
            economicEventId: dispatch.invoice.economicEventId,
            source: "workspace-accounting-connectors",
            period: {
              start: dispatch.invoice.issueDate,
              end: dispatch.invoice.paymentDate,
            },
            freshness: "fresh",
            confidence: 1,
            consentScope: dispatch.invoice.consentVersion,
            evidenceHash: dispatch.invoice.sourceEventHash,
            accountantReviewStatus: "pending",
          } as const;
        },
      },
      {
        id: "tax_engine_prepare",
        agentId: "tax_automation:tax_orchestrator",
        dependsOn: [
          "tax_evidence",
          "tax_jurisdiction",
          "tax_accounting_context",
        ],
        maxAttempts: 2,
        retryBackoffMs: 100,
        run: async () =>
          prepareTaxInvoiceCase(dependencies.engine, dispatch, runId),
      },
      {
        id: "tax_engine_checkpoint",
        agentId: "tax_automation:tax_orchestrator",
        dependsOn: ["tax_engine_prepare"],
        run: async () =>
          advanceTaxInvoiceCase(dependencies.engine, dispatch, runId),
      },
      {
        id: "tax_human_gate",
        kind: "approval",
        agentId: "human:tax-reviewer",
        dependsOn: ["tax_engine_checkpoint"],
        approval: {
          approvalId: `tax:${runId}:intent`,
          capability: "tax.invoice.review",
          summary:
            "Review the current evidence and continue the tax workflow. This acknowledgment never approves or issues an invoice.",
        },
      },
      {
        id: "tax_engine_resume",
        agentId: "tax_automation:tax_orchestrator",
        dependsOn: ["tax_human_gate"],
        run: async () =>
          advanceTaxInvoiceCase(dependencies.engine, dispatch, runId),
      },
    ],
  });
}

export async function runTaxAgentWorkflow(
  input: TaxAgentWorkflowInput,
  dependencies: TaxAgentWorkflowDependencies,
): Promise<TaxAgentWorkflowResult> {
  const definition = createTaxAgentWorkflow(input, dependencies);
  const persistedRunId = input.runId;
  const existing =
    persistedRunId && dependencies.store.load
      ? await dependencies.store.load(persistedRunId)
      : null;
  let workflow: WorkflowRun;
  if (existing && persistedRunId) {
    workflow = await resumeWorkflow(definition, {
      store: dependencies.store,
      runId: persistedRunId,
      resolveApproval: dependencies.resolveApproval,
    });
  } else {
    workflow = await runWorkflow(definition, {
      store: dependencies.store,
      runId: persistedRunId,
      resolveApproval: dependencies.resolveApproval,
    });
  }
  const evidence = parseEvidenceResult(workflow.results.tax_evidence);
  const checkpoints = [
    workflow.results.tax_engine_prepare,
    workflow.results.tax_engine_checkpoint,
    workflow.results.tax_engine_resume,
  ].filter(isCheckpoint);
  return { workflow, evidence, checkpoints };
}

export function buildEvidenceReport(
  dispatch: TaxInvoiceDispatch,
  references: readonly TaxEvidenceReference[],
): TaxEvidenceReport {
  const parsed = TaxInvoiceDispatchSchema.parse(dispatch);
  const safeReferences = references
    .map((reference) => TaxEvidenceReferenceSchema.parse(reference))
    .filter(
      (reference) =>
        reference.economicEventId === parsed.invoice.economicEventId,
    )
    .sort((left, right) => left.evidenceId.localeCompare(right.evidenceId));
  const sourceKinds = [
    ...new Set(safeReferences.map((reference) => reference.sourceKind)),
  ];
  const authoritative = sourceKinds.filter(
    (kind) =>
      ![
        "transaction_enrichment",
        "financial_analytics",
        "knowledge_graph",
      ].includes(kind),
  );
  const candidate = sourceKinds.filter((kind) => !authoritative.includes(kind));
  const missing: string[] = [];
  if (!authoritative.includes("accounting")) missing.push("accounting_entry");
  if (
    !authoritative.some((kind) => ["bank", "stripe", "wallet"].includes(kind))
  )
    missing.push("settlement_evidence");
  return {
    version: "tax-agent-evidence-report-v1",
    workspaceId: parsed.workspaceId,
    economicEventId: parsed.invoice.economicEventId,
    references: safeReferences,
    evidenceRoot: hashCanonical(safeReferences),
    authoritativeSources: authoritative,
    candidateSources: candidate,
    missing,
    accountantReviewStatus:
      missing.length > 0 ||
      safeReferences.some(
        (reference) => reference.accountantReviewStatus === "pending",
      )
        ? "pending"
        : "not_required",
  };
}

export function validateArgentinaExport(dispatch: TaxInvoiceDispatch) {
  const parsed = TaxInvoiceDispatchSchema.parse(dispatch);
  if (!parsed.workspaceId || parsed.invoice.destinationCountry.length !== 2)
    throw new Error("TAX_JURISDICTION_CONTEXT_REQUIRED");
  return {
    version: "tax-jurisdiction-gate-v1",
    jurisdiction: "AR",
    regime: "export_services_factura_e",
    destinationCountry: parsed.invoice.destinationCountry,
    ruleInputsTrusted: true,
    authorityAction: false,
    source: "tax-profile",
    period: {
      start: parsed.invoice.issueDate,
      end: parsed.invoice.paymentDate,
    },
    freshness: "fresh",
    confidence: 1,
    consentScope: parsed.invoice.consentVersion,
    evidenceHash: parsed.invoice.sourceEventHash,
    accountantReviewStatus: "pending",
  } as const;
}

function parseEvidenceResult(value: unknown): TaxEvidenceReport | null {
  const parsed = TaxEvidenceReportSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function isCheckpoint(value: unknown): value is TaxInvoiceCheckpoint {
  return Boolean(
    value &&
    typeof value === "object" &&
    "taxRunId" in value &&
    "phase" in value &&
    "revision" in value,
  );
}

function hashCanonical(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
