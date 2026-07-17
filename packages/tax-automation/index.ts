import { createHash } from "node:crypto";
import { Decimal } from "decimal.js";
import { z } from "zod";

import {
  type InvoiceSettlementEventV1,
  InvoiceSettlementEventV1Schema,
  taxSettlementCommandFor,
} from "./invoice-settlement";

export {
  TAX_DOMAIN_EVENT_DELIVERY_VERSION_V1,
  TAX_DOMAIN_EVENT_KINDS_V1,
  TAX_DOMAIN_EVENT_VERSION_V1,
  TaxDomainEventDeliveryV1Schema,
  TaxDomainEventV1Schema,
  taxDomainEventRequestHash,
  type TaxDomainEventDeliveryV1,
  type TaxDomainEventV1,
} from "./tax-domain-event";

export {
  type InvoiceSettlementEventV1,
  InvoiceSettlementEventV1Schema,
  type TaxSettlementCommand,
  settlementReferenceHashForEvent,
  taxSettlementCommandFor,
} from "./invoice-settlement";

const decimal = z.string().regex(/^\d+(?:\.\d+)?$/);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const isoDate = z.iso.date();
const isoDateTime = z.iso.datetime({ offset: true });

export const TaxInvoiceDispatchSchema = z
  .object({
    workspaceId: z.string().uuid(),
    actorId: z.string().min(2).max(191),
    idempotencyKey: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,191}$/),
    issuancePath: z.enum(["reclaim_copilot", "wsfex_delegated"]),
    invoice: z
      .object({
        ledgerInvoiceId: z.uuid(),
        artifactId: z.string().min(1).max(191),
        economicEventId: z.string().min(1).max(191),
        artifactHash: sha256,
        sourceEventHash: sha256,
        consentVersion: z.string().min(1).max(191),
        foreignCustomerSafeLabel: z.string().min(1).max(160),
        destinationCountry: z.string().regex(/^[A-Z]{2}$/),
        destinationCountryArcaCode: z.number().int().positive().max(999),
        pointOfSale: z.number().int().positive().max(99_998),
        issueDate: isoDate,
        paymentDate: isoDate,
        sameCurrencyPayment: z.boolean(),
        exchangeRate: z
          .object({
            decimal,
            sourceReferenceId: z.string().min(1).max(500),
            observedForDate: isoDate,
            authorityRuleDecisionId: z.string().min(1).max(191),
          })
          .strict()
          .nullable(),
        total: z
          .object({ decimal, currency: z.string().regex(/^[A-Z]{3,10}$/) })
          .strict(),
        serviceDescription: z.string().min(1).max(4_000),
        paymentTerms: z.string().min(1).max(1_000),
        unitCode: z.number().int().nonnegative().max(99),
        observedAt: isoDateTime,
      })
      .strict(),
  })
  .strict();

export type TaxInvoiceDispatch = z.infer<typeof TaxInvoiceDispatchSchema>;

const aiInvoiceLineItemSchema = z
  .object({
    name: z.string().trim().min(1).max(500),
    quantityDecimal: decimal,
    unitPriceCents: z.number().int().nonnegative().safe(),
  })
  .strict();

export const AiInvoiceArtifactDispatchSchema = z
  .object({
    workspaceId: z.string().uuid(),
    actorId: z.string().min(2).max(191),
    idempotencyKey: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,191}$/),
    issuancePath: z.enum(["reclaim_copilot", "wsfex_delegated"]),
    ledgerInvoiceId: z.uuid(),
    artifact: z
      .object({
        documentId: z.string().min(1).max(191),
        invoiceNumber: z.string().min(1).max(191),
        customerSafeLabel: z.string().trim().min(1).max(160),
        issueDate: isoDate,
        dueDate: isoDate,
        currency: z.string().regex(/^[A-Z]{3,10}$/),
        lineItems: z.array(aiInvoiceLineItemSchema).min(1).max(100),
        subtotalCents: z.number().int().nonnegative().safe(),
        taxAmountCents: z.number().int().nonnegative().safe().default(0),
        discountAmountCents: z.number().int().nonnegative().safe().default(0),
        totalCents: z.number().int().nonnegative().safe(),
        note: z.string().max(1_000).optional(),
      })
      .strict(),
    exportContext: z
      .object({
        destinationCountry: z.string().regex(/^[A-Z]{2}$/),
        destinationCountryArcaCode: z.number().int().positive().max(999),
        pointOfSale: z.number().int().positive().max(99_998),
        paymentDate: isoDate,
        sameCurrencyPayment: z.boolean(),
        exchangeRate: z
          .object({
            decimal,
            sourceReferenceId: z.string().min(1).max(500),
            observedForDate: isoDate,
            authorityRuleDecisionId: z.string().min(1).max(191),
          })
          .strict()
          .nullable(),
        consentVersion: z.string().min(1).max(191),
        unitCode: z.number().int().nonnegative().max(99).default(7),
        observedAt: isoDateTime,
      })
      .strict(),
  })
  .strict();

export type AiInvoiceArtifactDispatch = z.infer<
  typeof AiInvoiceArtifactDispatchSchema
>;

const deskInvoiceDocumentSchema = z
  .object({
    invoiceNumber: z.string().trim().min(1).max(191),
    title: z.string().trim().min(1).max(500),
    customerName: z.string().trim().min(1).max(160),
    customerEmail: z.email().optional(),
    fromName: z.string().trim().min(1).max(160).optional(),
    issueDate: isoDate,
    dueDate: isoDate,
    currency: z.string().regex(/^[A-Z]{3,10}$/),
    lineItems: z
      .array(
        z
          .object({
            name: z.string().trim().min(1).max(500),
            quantity: z.number().positive().finite(),
            price: z.number().int().nonnegative().safe(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
    subtotal: z.number().int().nonnegative().safe(),
    taxRate: z.number().nonnegative().finite().optional(),
    taxAmount: z.number().int().nonnegative().safe().optional(),
    discountPercent: z.number().nonnegative().max(100).finite().optional(),
    discountAmount: z.number().int().nonnegative().safe().optional(),
    total: z.number().int().nonnegative().safe(),
    note: z.string().max(1_000).optional(),
    status: z.enum(["draft", "sent", "paid"]).optional(),
  })
  .strict();

export const AiInvoiceDocumentDispatchSchema = z
  .object({
    workspaceId: z.string().uuid(),
    actorId: z.string().min(2).max(191),
    idempotencyKey: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,191}$/),
    issuancePath: z.enum(["reclaim_copilot", "wsfex_delegated"]),
    ledgerInvoiceId: z.uuid(),
    document: z
      .object({
        id: z.string().min(1).max(191),
        kind: z.literal("invoice"),
        content: z.string().min(2).max(100_000),
      })
      .strict(),
    exportContext: AiInvoiceArtifactDispatchSchema.shape.exportContext,
  })
  .strict();

export type AiInvoiceDocumentDispatch = z.infer<
  typeof AiInvoiceDocumentDispatchSchema
>;

/**
 * Converts the invoice document emitted by BUFI's `create_document` AI tool
 * directly into the durable Tax Automation ingress. The document is parsed
 * with a strict schema before the existing exact-money and server-hash checks.
 */
export function dispatchFromAiInvoiceDocument(
  input: AiInvoiceDocumentDispatch,
): TaxInvoiceDispatch {
  const parsed = AiInvoiceDocumentDispatchSchema.parse(input);
  let content: unknown;
  try {
    content = JSON.parse(parsed.document.content);
  } catch {
    throw new Error("AI invoice document is not valid JSON");
  }
  const invoice = deskInvoiceDocumentSchema.parse(content);
  return dispatchFromAiInvoiceArtifact({
    workspaceId: parsed.workspaceId,
    actorId: parsed.actorId,
    idempotencyKey: parsed.idempotencyKey,
    issuancePath: parsed.issuancePath,
    ledgerInvoiceId: parsed.ledgerInvoiceId,
    artifact: {
      documentId: parsed.document.id,
      invoiceNumber: invoice.invoiceNumber,
      customerSafeLabel: invoice.customerName,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      currency: invoice.currency,
      lineItems: invoice.lineItems.map((item) => ({
        name: item.name,
        quantityDecimal: String(item.quantity),
        unitPriceCents: item.price,
      })),
      subtotalCents: invoice.subtotal,
      taxAmountCents: invoice.taxAmount ?? 0,
      discountAmountCents: invoice.discountAmount ?? 0,
      totalCents: invoice.total,
      note: invoice.note,
    },
    exportContext: parsed.exportContext,
  });
}

export function dispatchFromAiInvoiceArtifact(
  input: AiInvoiceArtifactDispatch,
): TaxInvoiceDispatch {
  const parsed = AiInvoiceArtifactDispatchSchema.parse(input);
  assertAiInvoiceTotals(parsed.artifact);
  const artifactHash = hash(stableJson(parsed.artifact));
  const sourceEventHash = hash(
    stableJson({
      workspaceId: parsed.workspaceId,
      ledgerInvoiceId: parsed.ledgerInvoiceId,
      documentId: parsed.artifact.documentId,
      artifactHash,
      consentVersion: parsed.exportContext.consentVersion,
    }),
  );
  const serviceDescription = parsed.artifact.lineItems
    .map((item) => item.name)
    .join("; ")
    .slice(0, 4_000);
  return TaxInvoiceDispatchSchema.parse({
    workspaceId: parsed.workspaceId,
    actorId: parsed.actorId,
    idempotencyKey: parsed.idempotencyKey,
    issuancePath: parsed.issuancePath,
    invoice: {
      ledgerInvoiceId: parsed.ledgerInvoiceId,
      artifactId: parsed.artifact.documentId,
      economicEventId: `invoice:${parsed.ledgerInvoiceId}`,
      artifactHash,
      sourceEventHash,
      consentVersion: parsed.exportContext.consentVersion,
      foreignCustomerSafeLabel: parsed.artifact.customerSafeLabel,
      destinationCountry: parsed.exportContext.destinationCountry,
      destinationCountryArcaCode:
        parsed.exportContext.destinationCountryArcaCode,
      pointOfSale: parsed.exportContext.pointOfSale,
      issueDate: parsed.artifact.issueDate,
      paymentDate: parsed.exportContext.paymentDate,
      sameCurrencyPayment: parsed.exportContext.sameCurrencyPayment,
      exchangeRate: parsed.exportContext.exchangeRate,
      total: {
        decimal: centsToDecimal(parsed.artifact.totalCents),
        currency: parsed.artifact.currency,
      },
      serviceDescription,
      paymentTerms: parsed.artifact.note ?? `Due ${parsed.artifact.dueDate}`,
      unitCode: parsed.exportContext.unitCode,
      observedAt: parsed.exportContext.observedAt,
    },
  });
}

export function taxRunIdFor(
  workspaceId: string,
  idempotencyKey: string,
): string {
  const bytes = Buffer.from(
    hash(`${workspaceId}:${idempotencyKey}`).slice(0, 32),
    "hex",
  );
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const TaxRunSchema = z
  .object({
    runId: z.string().uuid(),
    workspaceId: z.string(),
    issuancePath: z.enum(["reclaim_copilot", "wsfex_delegated"]),
    readinessState: z.enum([
      "unverified",
      "proof_pending",
      "verified",
      "failed",
    ]),
    intentState: z.enum(["missing", "drafted", "validated", "frozen"]),
    approvalState: z.enum([
      "not_requested",
      "pending",
      "user_approved",
      "accountant_approved",
      "rejected",
    ]),
    issuanceState: z.enum([
      "not_ready",
      "manual_action_required",
      "ready_for_wsfex",
      "submitted",
      "ambiguous",
      "arca_authorized",
      "rejected",
    ]),
    settlementState: z.enum([
      "unobserved",
      "observed",
      "final",
      "reversed",
      "disputed",
    ]),
    fxIngressState: z.enum(["unverified", "verified", "not_applicable"]),
    taxDeclarationState: z.enum([
      "not_ready",
      "ready_for_accountant",
      "declared",
      "amendment_required",
    ]),
    financeEligibility: z.enum(["frozen", "reviewable"]),
    intentHash: sha256.nullable(),
    revision: z.number().int().positive(),
  })
  .passthrough();

export type TaxAutomationRun = z.infer<typeof TaxRunSchema>;

export type TaxSettlementRecordResult = Readonly<{
  run: TaxAutomationRun;
  replayed: boolean;
}>;

const RunEnvelopeSchema = z
  .object({
    data: TaxRunSchema,
    nextActions: z.array(z.string()),
  })
  .strict();

export type TaxInvoicePhase =
  | "readiness_interaction_required"
  | "readiness_pending"
  | "approval_required"
  | "accountant_approval_required"
  | "manual_arca_issuance_required"
  | "wsfex_submission_required"
  | "authority_pending"
  | "authorized"
  | "settlement_pending"
  | "settlement_attention_required"
  | "fx_ingress_review_required"
  | "tax_declaration_review_required"
  | "accounting_ready"
  | "rejected"
  | "blocked";

export type TaxInvoiceCheckpoint = Readonly<{
  taxRunId: string;
  phase: TaxInvoicePhase;
  terminal: boolean;
  intentHash: string | null;
  nextActions: readonly string[];
  handoff: Readonly<Record<string, unknown>> | null;
  revision: number;
}>;

type Fetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type TaxAutomationClientOptions = Readonly<{
  baseUrl: string;
  agentApiKey: string;
  evidenceIngestToken: string;
  fetchImpl?: Fetch;
}>;

export class TaxAutomationClient {
  readonly #baseUrl: URL;
  readonly #agentApiKey: string;
  readonly #evidenceIngestToken: string;
  readonly #fetch: Fetch;

  constructor(options: TaxAutomationClientOptions) {
    this.#baseUrl = safeBaseUrl(options.baseUrl);
    if (options.agentApiKey.length < 16)
      throw new Error("Tax agent API key is not configured");
    if (options.evidenceIngestToken.length < 16)
      throw new Error("Tax evidence ingest token is not configured");
    this.#agentApiKey = options.agentApiKey;
    this.#evidenceIngestToken = options.evidenceIngestToken;
    this.#fetch = options.fetchImpl ?? fetch;
  }

  async appendInvoiceEvidence(input: TaxInvoiceDispatch): Promise<void> {
    const parsed = TaxInvoiceDispatchSchema.parse(input);
    const invoice = parsed.invoice;
    const response = await this.#request("/v1/evidence/append", {
      method: "POST",
      headers: { "x-tax-evidence-ingest-token": this.#evidenceIngestToken },
      body: {
        records: [
          {
            evidenceId: `bufi-invoice:${invoice.ledgerInvoiceId}`,
            workspaceId: parsed.workspaceId,
            revision: "1",
            sourceId: "bufi:invoice-ai",
            sourceKind: "bufi_invoice",
            canonicalProviderId: "bufi",
            externalReferenceHash: hash(`artifact:${invoice.artifactId}`),
            sourceEventHash: invoice.sourceEventHash,
            artifactHash: invoice.artifactHash,
            jurisdiction: "AR",
            period: { start: invoice.issueDate, end: invoice.paymentDate },
            observedAt: invoice.observedAt,
            expiresAt: null,
            economicEventId: invoice.economicEventId,
            economicRole: "invoice",
            countingDimension: "revenue",
            direction: "inflow",
            money: invoice.total,
            normalizedMoney: invoice.total,
            fxReferenceId: invoice.exchangeRate?.sourceReferenceId ?? null,
            partyClaimHash: hash(invoice.foreignCustomerSafeLabel),
            accountReferenceHash: hash(parsed.workspaceId),
            confidence: { extraction: "1", classification: "1", matching: "1" },
            reviewState: "accepted",
            consentVersion: invoice.consentVersion,
            idempotencyKey: hash(
              [
                parsed.workspaceId,
                invoice.ledgerInvoiceId,
                invoice.artifactId,
                invoice.artifactHash,
                invoice.consentVersion,
              ].join(":"),
            ),
          },
        ],
      },
    });
    await safeJson(response);
  }

  async createCase(
    input: TaxInvoiceDispatch,
    runId: string,
  ): Promise<TaxAutomationRun> {
    const result = await this.#invoke(
      "tax_ar_factura_e_create_case",
      input.actorId,
      `${input.idempotencyKey}:case`,
      {
        runId,
        workspaceId: input.workspaceId,
        issuancePath: input.issuancePath,
      },
    );
    return mutationRun(result);
  }

  async startReadiness(
    input: TaxInvoiceDispatch,
    runId: string,
  ): Promise<Record<string, unknown>> {
    const result = await this.#invoke(
      "tax_ar_reclaim_start",
      input.actorId,
      `${input.idempotencyKey}:readiness`,
      {
        runId,
        purpose: "arca_taxpayer_readiness",
        subjectId: null,
      },
    );
    return mutationOutput(result);
  }

  async proposeFromEvidence(
    input: TaxInvoiceDispatch,
    runId: string,
  ): Promise<TaxAutomationRun> {
    const invoice = input.invoice;
    const result = await this.#invoke(
      "tax_ar_factura_e_propose_from_evidence",
      input.actorId,
      `${input.idempotencyKey}:draft`,
      {
        runId,
        economicEventId: invoice.economicEventId,
        intentId: `bufi-ai:${invoice.ledgerInvoiceId}`,
        foreignCustomerSafeLabel: invoice.foreignCustomerSafeLabel,
        destinationCountry: invoice.destinationCountry,
        destinationCountryArcaCode: invoice.destinationCountryArcaCode,
        pointOfSale: invoice.pointOfSale,
        issueDate: invoice.issueDate,
        paymentDate: invoice.paymentDate,
        sameCurrencyPayment: invoice.sameCurrencyPayment,
        exchangeRate: invoice.exchangeRate,
        serviceDescription: invoice.serviceDescription,
        paymentTerms: invoice.paymentTerms,
        unitCode: invoice.unitCode,
      },
    );
    return mutationRun(result);
  }

  async requestApproval(
    input: TaxInvoiceDispatch,
    runId: string,
  ): Promise<TaxAutomationRun> {
    const result = await this.#invoke(
      "tax_ar_factura_e_request_approval",
      input.actorId,
      `${input.idempotencyKey}:request-approval`,
      { runId },
    );
    return mutationRun(result);
  }

  async recordInvoiceSettlement(
    runId: string,
    event: InvoiceSettlementEventV1,
    actorId = "agent:tax-settlement",
  ): Promise<TaxSettlementRecordResult> {
    const parsedEvent = InvoiceSettlementEventV1Schema.parse(event);
    const result = await this.#invoke(
      "tax_ar_factura_e_record_settlement",
      actorId,
      `invoice-settlement:${parsedEvent.eventId}`,
      {
        runId,
        settlement: taxSettlementCommandFor(parsedEvent),
      },
    );
    const parsed = z
      .object({ run: TaxRunSchema, replayed: z.boolean() })
      .passthrough()
      .parse(mutationData(result));
    if (
      parsed.run.runId !== runId ||
      parsed.run.workspaceId !== parsedEvent.teamId
    )
      throw new Error(
        "Tax Automation Engine request failed: TAX_AUTOMATION_RESPONSE_IDENTITY_MISMATCH",
      );
    return { run: parsed.run, replayed: parsed.replayed };
  }

  async getRun(
    runId: string,
  ): Promise<{ run: TaxAutomationRun; nextActions: readonly string[] }> {
    const response = await this.#request(
      `/v1/agent/runs/${encodeURIComponent(runId)}`,
    );
    const parsed = RunEnvelopeSchema.parse(await safeJson(response));
    return { run: parsed.data, nextActions: parsed.nextActions };
  }

  async getCopilotPacket(
    runId: string,
    key: string,
  ): Promise<Record<string, unknown>> {
    const result = await this.#invoke(
      "tax_ar_factura_e_get_copilot_packet",
      "agent:tax",
      `${key}:copilot`,
      {
        runId,
      },
    );
    return mutationData(result);
  }

  async getAttestationPacket(
    runId: string,
    key: string,
  ): Promise<Record<string, unknown>> {
    const result = await this.#invoke(
      "tax_ar_factura_e_get_accounting_attestation_packet",
      "agent:tax",
      `${key}:attestation`,
      { runId },
    );
    return mutationData(result);
  }

  async #invoke(
    toolId: string,
    actorId: string,
    idempotencyKey: string,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    const response = await this.#request(`/v1/agent/tools/${toolId}/invoke`, {
      method: "POST",
      body: { actorId, idempotencyKey, input },
    });
    return safeJson(response);
  }

  async #request(
    path: string,
    options: Readonly<{
      method?: "GET" | "POST";
      headers?: Record<string, string>;
      body?: unknown;
    }> = {},
  ): Promise<Response> {
    const response = await this.#fetch(new URL(path, this.#baseUrl), {
      method: options.method ?? "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${this.#agentApiKey}`,
        ...(options.body === undefined
          ? {}
          : { "content-type": "application/json" }),
        ...options.headers,
      },
      ...(options.body === undefined
        ? {}
        : { body: JSON.stringify(options.body) }),
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      const payload = (await response
        .clone()
        .json()
        .catch(() => null)) as { error?: unknown } | null;
      const code =
        typeof payload?.error === "string"
          ? payload.error.slice(0, 120)
          : `HTTP_${response.status}`;
      throw new Error(`Tax Automation Engine rejected the request: ${code}`);
    }
    return response;
  }
}

export async function prepareTaxInvoiceCase(
  client: TaxAutomationClient,
  input: TaxInvoiceDispatch,
  runId: string,
): Promise<TaxInvoiceCheckpoint> {
  const parsed = TaxInvoiceDispatchSchema.parse(input);
  await client.appendInvoiceEvidence(parsed);
  await client.createCase(parsed, runId);
  const handoff = await client.startReadiness(parsed, runId);
  const { run, nextActions } = await client.getRun(runId);
  return checkpoint(
    run,
    nextActions,
    "readiness_interaction_required",
    handoff,
  );
}

export async function advanceTaxInvoiceCase(
  client: TaxAutomationClient,
  input: TaxInvoiceDispatch,
  runId: string,
): Promise<TaxInvoiceCheckpoint> {
  const current = await client.getRun(runId);
  let run = current.run;
  let nextActions = current.nextActions;

  if (run.issuanceState === "rejected" || run.approvalState === "rejected")
    return checkpoint(run, nextActions, "rejected", null, true);
  if (run.readinessState === "failed")
    return checkpoint(run, nextActions, "blocked", null, true);
  if (run.readinessState !== "verified")
    return checkpoint(run, nextActions, "readiness_pending", null);

  if (run.intentState === "missing" || run.intentState === "drafted") {
    run = await client.proposeFromEvidence(input, runId);
    nextActions = (await client.getRun(runId)).nextActions;
  }
  if (
    run.intentState === "validated" &&
    run.approvalState === "not_requested"
  ) {
    run = await client.requestApproval(input, runId);
    nextActions = (await client.getRun(runId)).nextActions;
  }
  if (run.approvalState === "pending")
    return checkpoint(run, nextActions, "approval_required", null);
  if (
    run.approvalState === "user_approved" &&
    input.issuancePath === "wsfex_delegated"
  )
    return checkpoint(run, nextActions, "accountant_approval_required", null);
  if (run.issuanceState === "manual_action_required") {
    const handoff = await client.getCopilotPacket(runId, input.idempotencyKey);
    return checkpoint(
      run,
      nextActions,
      "manual_arca_issuance_required",
      handoff,
    );
  }
  if (run.issuanceState === "ready_for_wsfex")
    return checkpoint(run, nextActions, "wsfex_submission_required", null);
  if (run.issuanceState === "submitted" || run.issuanceState === "ambiguous")
    return checkpoint(run, nextActions, "authority_pending", null);
  if (run.issuanceState === "arca_authorized") {
    const handoff = await client.getAttestationPacket(
      runId,
      input.idempotencyKey,
    );
    if (
      run.settlementState === "reversed" ||
      run.settlementState === "disputed"
    )
      return checkpoint(
        run,
        nextActions,
        "settlement_attention_required",
        handoff,
      );
    if (run.settlementState !== "final")
      return checkpoint(run, nextActions, "settlement_pending", handoff);
    if (run.fxIngressState === "unverified")
      return checkpoint(
        run,
        nextActions,
        "fx_ingress_review_required",
        handoff,
      );
    if (run.taxDeclarationState !== "declared")
      return checkpoint(
        run,
        nextActions,
        "tax_declaration_review_required",
        handoff,
      );
    return checkpoint(run, nextActions, "accounting_ready", handoff, true);
  }
  return checkpoint(run, nextActions, "authority_pending", null);
}

function checkpoint(
  run: TaxAutomationRun,
  nextActions: readonly string[],
  phase: TaxInvoicePhase,
  handoff: Record<string, unknown> | null,
  terminal = false,
): TaxInvoiceCheckpoint {
  return {
    taxRunId: run.runId,
    phase,
    terminal,
    intentHash: run.intentHash,
    nextActions,
    handoff,
    revision: run.revision,
  };
}

function mutationData(value: unknown): Record<string, unknown> {
  const parsed = z
    .object({ data: z.record(z.string(), z.unknown()) })
    .strict()
    .parse(value);
  return parsed.data;
}

function mutationRun(value: unknown): TaxAutomationRun {
  const data = mutationData(value);
  return TaxRunSchema.parse(data.run);
}

function mutationOutput(value: unknown): Record<string, unknown> {
  const data = mutationData(value);
  return z.record(z.string(), z.unknown()).parse(data.output);
}

async function safeJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json"))
    throw new Error("Tax Automation Engine returned non-JSON data");
  return response.json();
}

function safeBaseUrl(value: string): URL {
  const url = new URL(value);
  const localhost =
    url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(localhost && url.protocol === "http:"))
    throw new Error("Tax Automation Engine URL must use HTTPS");
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url;
}

function assertAiInvoiceTotals(
  artifact: AiInvoiceArtifactDispatch["artifact"],
): void {
  const lineSubtotal = artifact.lineItems.reduce((sum, item) => {
    const lineTotal = new Decimal(item.unitPriceCents).mul(
      item.quantityDecimal,
    );
    if (!lineTotal.isInteger())
      throw new Error("AI invoice line total has fractional minor units");
    return sum.add(lineTotal);
  }, new Decimal(0));
  if (!lineSubtotal.eq(artifact.subtotalCents))
    throw new Error("AI invoice subtotal does not match its line items");
  const expectedTotal = new Decimal(artifact.subtotalCents)
    .add(artifact.taxAmountCents)
    .sub(artifact.discountAmountCents);
  if (expectedTotal.isNegative() || !expectedTotal.eq(artifact.totalCents))
    throw new Error("AI invoice total does not reconcile exactly");
}

function centsToDecimal(cents: number): string {
  const digits = String(cents).padStart(3, "0");
  return `${digits.slice(0, -2)}.${digits.slice(-2)}`;
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

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
