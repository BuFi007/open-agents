import { createHash, createHmac } from "node:crypto";
import {
  accountantReviewQueueEnvelopeV1Schema,
  facturaEFactoringProjectionReadResultV1Schema,
  projectionKeySchema,
  safeReferenceSchema,
  taxSnapshotReadResultV1Schema,
  type AccountantReviewQueueV1,
  type FacturaEFactoringProjectionReadResultV1,
  type TaxSnapshotReadResultV1,
} from "@tax-engine/browser-contracts";
import { Decimal } from "decimal.js";
import { z } from "zod";

import {
  type InvoiceSettlementEventV1,
  InvoiceSettlementEventV1Schema,
  taxSettlementCommandFor,
} from "./invoice-settlement";
import { TaxAutomationRequestError } from "./request-error";
import {
  TaxSetupCatalogueSchema,
  TaxSetupConfigurationReceiptSchema,
  TaxSetupProfileSchema,
  TaxSetupProjectionKeySchema,
  TaxSetupWorkspaceIdSchema,
  type TaxSetupProfile,
} from "./setup-contract";

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
export {
  TaxAuthorityApprovalClient,
  createServerHeldFacturaEApprovalRef,
  deriveServerHeldFacturaEApprovalRef,
} from "./authority-corridor";
export type {
  RegisterFacturaEAuthorityApprovalInput,
  SafeFacturaEAuthorityApprovalReceipt,
  TaxAuthorityApprovalClientOptions,
} from "./authority-corridor";
export { TaxAutomationRequestError } from "./request-error";
export {
  TaxSetupCatalogueSchema,
  TaxSetupConfigurationReceiptSchema,
  TaxSetupDataScopeSchema,
  TaxSetupJurisdictionSchema,
  TaxSetupOperationRequestSchema,
  TaxSetupOperationResultSchema,
  TaxSetupProfileSchema,
  TaxSetupProjectionKeySchema,
  TaxSetupWorkspaceIdSchema,
} from "./setup-contract";
export type {
  TaxSetupConfigurationReceipt,
  TaxSetupOperationRequest,
  TaxSetupOperationResult,
  TaxSetupProfile,
} from "./setup-contract";

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
    intent: z
      .object({
        taxpayerReferenceHash: sha256,
        foreignCustomerReferenceHash: sha256,
      })
      .passthrough()
      .nullable()
      .optional(),
    revision: z.number().int().positive(),
  })
  .passthrough();

export type TaxAutomationRun = z.infer<typeof TaxRunSchema>;

/**
 * Legacy core snapshot identity envelope, retained only for the dual-read
 * rollout. This is not the browser contract; browser responses are validated
 * exclusively by @tax-engine/browser-contracts.
 */
export const TaxWidgetSnapshotEnvelopeSchema = z
  .object({
    version: z.literal("tax-widget-v1"),
    workspaceId: safeReferenceSchema,
    period: z.object({ start: isoDate, end: isoDate }).strict(),
    displayCurrency: z.string().regex(/^[A-Z][A-Z0-9]{2,11}$/),
    inputHash: sha256,
  })
  .passthrough();

export type TaxWidgetSnapshotEnvelope = z.infer<
  typeof TaxWidgetSnapshotEnvelopeSchema
>;

export const TaxSnapshotReadRequestSchema = z
  .object({
    workspaceId: safeReferenceSchema,
    actorId: z.string().min(1).max(300),
    projectionKey: projectionKeySchema.optional(),
  })
  .strict();

export type TaxSnapshotReadRequest = z.infer<
  typeof TaxSnapshotReadRequestSchema
>;

export const AccountantPortfolioReadRequestSchema = z
  .object({
    workspaceId: safeReferenceSchema,
    actorId: z.string().min(1).max(300),
  })
  .strict();

export const AccountantReviewQueueReadRequestSchema =
  AccountantPortfolioReadRequestSchema;

const AccountantClientCaseSummarySchema = z
  .object({
    version: z.literal("accountant-client-case-summary-v1"),
    workspaceId: safeReferenceSchema,
    nextDueAt: z.iso.datetime({ offset: true }).nullable(),
    outstandingObligationCount: z.number().int().nonnegative(),
    professionalReviewCount: z.number().int().nonnegative(),
    clientApprovalCount: z.number().int().nonnegative(),
  })
  .strict();

export const AccountantPortfolioProjectionSchema = z
  .object({
    version: z.literal("accountant-portfolio-projection-v1"),
    accountantActorId: z.string().min(1).max(300),
    accountantOrganizationId: safeReferenceSchema,
    asOf: z.iso.datetime({ offset: true }),
    clients: z.array(AccountantClientCaseSummarySchema).max(500),
    mandates: z
      .array(
        z
          .object({
            version: z.literal("accountant-mandate-v1"),
            mandateId: safeReferenceSchema,
            workspaceId: safeReferenceSchema,
            accountantActorId: z.string().min(1).max(300),
            accountantOrganizationId: safeReferenceSchema,
            scopes: z
              .array(
                z.enum([
                  "review_tax_obligation",
                  "approve_invoice_intent",
                  "approve_invoice_adjustment",
                  "verify_fx_ingress",
                  "record_tax_declaration",
                  "export_accountant_packet",
                ]),
              )
              .min(1)
              .max(6),
            grantedByActorId: z.string().min(1).max(300),
            grantedAt: z.iso.datetime({ offset: true }),
            expiresAt: z.iso.datetime({ offset: true }),
            revokedAt: z.iso.datetime({ offset: true }).nullable(),
          })
          .strict(),
      )
      .max(1_000),
    totals: z
      .object({
        authorizedClientCount: z.number().int().nonnegative(),
        outstandingObligationCount: z.number().int().nonnegative(),
        professionalReviewCount: z.number().int().nonnegative(),
        clientApprovalCount: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

export type AccountantPortfolioProjection = z.infer<
  typeof AccountantPortfolioProjectionSchema
>;

export const TaxFactoringProjectionReadRequestSchema =
  TaxSnapshotReadRequestSchema;

export type TaxFactoringProjectionReadRequest = z.infer<
  typeof TaxFactoringProjectionReadRequestSchema
>;

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
  taxpayerReferenceHash: string | null;
  foreignCustomerReferenceHash: string | null;
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
  agentPrincipalSecret: string;
  userApprovalToken?: string;
  fetchImpl?: Fetch;
}>;

/**
 * A request-scoped assertion forwarded from the authenticated user boundary.
 * Open Agents must neither persist these values nor possess the signing key.
 */
export type ForwardedTaxTenantPrincipalHeaders = Readonly<{
  "x-tax-tenant-principal": string;
  "x-tax-tenant-signature": string;
}>;

const TaxTenantPrincipalSchema = z
  .object({
    version: z.literal("tax-tenant-principal-v2"),
    workspaceId: safeReferenceSchema,
    actorId: z.string().min(1).max(300),
    capability: z.enum([
      "profile:read",
      "profile:confirm",
      "snapshot:configure",
      "snapshot:read",
      "tax.factoring.read",
      "accountant:portfolio",
      "accountant:review-queue",
    ]),
    expiresAt: z.iso.datetime({ offset: true }),
  })
  .strict();

const TAX_TENANT_PRINCIPAL_MAX_TTL_MS = 300_000;
const TAX_AGENT_PRINCIPAL_TTL_MS = 60_000;
const taxCataloguesEnvelopeSchema = z
  .object({ data: z.array(TaxSetupCatalogueSchema).min(1).max(10) })
  .strict();
const taxProfileEnvelopeSchema = z
  .object({ data: TaxSetupProfileSchema })
  .strict();

function taxAgentPrincipalHeaders(
  input: Readonly<{
    secret: string;
    workspaceId: string;
    actorId: string;
    toolId: string;
    path: string;
    rawBody: string;
    idempotencyKey: string;
    expiresAt: string;
  }>,
): Record<string, string> {
  const principal = {
    version: "tax-agent-principal-v1" as const,
    workspaceId: z.string().uuid().parse(input.workspaceId),
    actorId: z.string().min(1).max(300).parse(input.actorId),
    toolId: z
      .string()
      .regex(/^tax_[a-z0-9_]{1,120}$/)
      .parse(input.toolId),
    method: "POST" as const,
    path: z
      .string()
      .regex(/^\/v1\/agent\/tools\/tax_[a-z0-9_]+\/invoke$/)
      .parse(input.path),
    bodyHash: createHash("sha256").update(input.rawBody, "utf8").digest("hex"),
    idempotencyKey: z.string().min(8).max(200).parse(input.idempotencyKey),
    expiresAt: z.iso.datetime({ offset: true }).parse(input.expiresAt),
  };
  const remainingTtl = Date.parse(principal.expiresAt) - Date.now();
  if (remainingTtl <= 0 || remainingTtl > TAX_AGENT_PRINCIPAL_TTL_MS) {
    throw new Error("Tax agent principal lifetime is invalid");
  }
  const encoded = Buffer.from(JSON.stringify(principal), "utf8").toString(
    "base64url",
  );
  return {
    "x-tax-agent-principal": encoded,
    "x-tax-agent-principal-signature": createHmac("sha256", input.secret)
      .update(encoded, "utf8")
      .digest("hex"),
  };
}
const taxConfigurationEnvelopeSchema = z
  .object({ data: TaxSetupConfigurationReceiptSchema })
  .strict();
const taxConfigurationWriteEnvelopeSchema = z
  .object({
    data: TaxSetupConfigurationReceiptSchema.extend({
      replayed: z.boolean(),
    }).strict(),
  })
  .strict();
const taxNotFoundEnvelopeSchema = z
  .object({
    error: z.enum(["NOT_FOUND", "TAX_SNAPSHOT_PROJECTION_CONFIG_REQUIRED"]),
  })
  .strict();
const taxErrorEnvelopeSchema = z.object({
  error: z.string().min(1).max(120),
});

function validateForwardedTaxTenantPrincipal(
  encodedPrincipal: unknown,
  signature: unknown,
  expectedWorkspaceId: string,
  expectedActorId: string,
  expectedCapability:
    | "profile:read"
    | "profile:confirm"
    | "snapshot:configure"
    | "snapshot:read"
    | "tax.factoring.read"
    | "accountant:portfolio"
    | "accountant:review-queue",
  nowMs = Date.now(),
): void {
  // This is a fail-closed syntax/scope preflight. Tax authenticates the MAC.
  if (
    typeof encodedPrincipal !== "string" ||
    encodedPrincipal.length < 1 ||
    encodedPrincipal.length > 4_096 ||
    !/^[A-Za-z0-9_-]+$/.test(encodedPrincipal) ||
    typeof signature !== "string" ||
    !/^[a-f0-9]{64}$/.test(signature)
  ) {
    throw new TaxAutomationRequestError("TAX_SNAPSHOT_PRINCIPAL_INVALID", 403);
  }

  let decoded: string;
  try {
    decoded = Buffer.from(encodedPrincipal, "base64url").toString("utf8");
  } catch {
    throw new TaxAutomationRequestError("TAX_SNAPSHOT_PRINCIPAL_INVALID", 403);
  }
  if (Buffer.from(decoded, "utf8").toString("base64url") !== encodedPrincipal) {
    throw new TaxAutomationRequestError("TAX_SNAPSHOT_PRINCIPAL_INVALID", 403);
  }

  const parsed = TaxTenantPrincipalSchema.safeParse(
    (() => {
      try {
        return JSON.parse(decoded) as unknown;
      } catch {
        return null;
      }
    })(),
  );
  if (!parsed.success) {
    throw new TaxAutomationRequestError("TAX_SNAPSHOT_PRINCIPAL_INVALID", 403);
  }
  const canonical = JSON.stringify({
    version: parsed.data.version,
    workspaceId: parsed.data.workspaceId,
    actorId: parsed.data.actorId,
    capability: parsed.data.capability,
    expiresAt: parsed.data.expiresAt,
  });
  if (decoded !== canonical) {
    throw new TaxAutomationRequestError("TAX_SNAPSHOT_PRINCIPAL_INVALID", 403);
  }
  if (
    parsed.data.workspaceId !== expectedWorkspaceId ||
    parsed.data.actorId !== expectedActorId ||
    parsed.data.capability !== expectedCapability
  ) {
    throw new TaxAutomationRequestError(
      "TAX_SNAPSHOT_PRINCIPAL_SCOPE_MISMATCH",
      403,
    );
  }
  const expiresAtMs = Date.parse(parsed.data.expiresAt);
  if (
    expiresAtMs <= nowMs ||
    expiresAtMs - nowMs > TAX_TENANT_PRINCIPAL_MAX_TTL_MS
  ) {
    throw new TaxAutomationRequestError("TAX_SNAPSHOT_PRINCIPAL_INVALID", 403);
  }
}

function validatedSetupPrincipalHeaders(
  forwardedPrincipal: ForwardedTaxTenantPrincipalHeaders,
  workspaceId: string,
  actorId: string,
  capability: "profile:read" | "profile:confirm" | "snapshot:configure",
): Record<string, string> {
  const encodedPrincipal = forwardedPrincipal["x-tax-tenant-principal"];
  const signature = forwardedPrincipal["x-tax-tenant-signature"];
  validateForwardedTaxTenantPrincipal(
    encodedPrincipal,
    signature,
    workspaceId,
    actorId,
    capability,
  );
  return {
    "x-tax-tenant-principal": encodedPrincipal,
    "x-tax-tenant-signature": signature,
  };
}

export class TaxAutomationClient {
  readonly #baseUrl: URL;
  readonly #agentApiKey: string;
  readonly #agentPrincipalSecret: string;
  readonly #userApprovalToken: string;
  readonly #fetch: Fetch;

  constructor(options: TaxAutomationClientOptions) {
    this.#baseUrl = safeBaseUrl(options.baseUrl);
    if (options.agentApiKey.length < 16)
      throw new Error("Tax agent API key is not configured");
    if (
      options.agentPrincipalSecret.length < 32 ||
      options.agentPrincipalSecret === options.agentApiKey
    )
      throw new Error(
        "Tax agent principal secret is not configured or isolated",
      );
    this.#agentApiKey = options.agentApiKey;
    this.#agentPrincipalSecret = options.agentPrincipalSecret;
    this.#userApprovalToken = options.userApprovalToken ?? "";
    this.#fetch = options.fetchImpl ?? fetch;
  }

  async createCase(
    input: TaxInvoiceDispatch,
    runId: string,
  ): Promise<TaxAutomationRun> {
    const result = await this.#invoke(
      "tax_ar_factura_e_create_case",
      input.workspaceId,
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
      input.workspaceId,
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
      input.workspaceId,
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
      input.workspaceId,
      input.actorId,
      `${input.idempotencyKey}:request-approval`,
      { runId },
    );
    return mutationRun(result);
  }

  async approveInvoiceIntent(
    input: Readonly<{
      workspaceId: string;
      actorId: string;
      runId: string;
      intentHash: string;
      idempotencyKey: string;
    }>,
  ): Promise<TaxAutomationRun> {
    if (this.#userApprovalToken.length < 32)
      throw new Error("Tax user approval channel is not configured");
    const path = `/v1/agent/runs/${encodeURIComponent(input.runId)}/user-approval`;
    const response = await this.#request(path, {
      method: "POST",
      headers: { "x-tax-user-approval-token": this.#userApprovalToken },
      body: {
        actorId: input.actorId,
        intentHash: input.intentHash,
        idempotencyKey: input.idempotencyKey,
      },
    });
    const parsed = z
      .object({ data: z.object({ run: TaxRunSchema }).passthrough() })
      .passthrough()
      .parse(await safeJson(response));
    if (
      parsed.data.run.runId !== input.runId ||
      parsed.data.run.workspaceId !== input.workspaceId ||
      parsed.data.run.intentHash !== input.intentHash
    )
      throw new TaxAutomationRequestError(
        "TAX_AUTOMATION_RESPONSE_IDENTITY_MISMATCH",
        502,
      );
    return parsed.data.run;
  }

  async recordInvoiceSettlement(
    runId: string,
    event: InvoiceSettlementEventV1,
    actorId = "agent:tax-settlement",
  ): Promise<TaxSettlementRecordResult> {
    const parsedEvent = InvoiceSettlementEventV1Schema.parse(event);
    const result = await this.#invoke(
      "tax_ar_factura_e_record_settlement",
      parsedEvent.teamId,
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

  async getLatestSnapshot(
    workspaceId: string,
  ): Promise<TaxWidgetSnapshotEnvelope> {
    const expectedWorkspaceId = z.string().uuid().parse(workspaceId);
    const response = await this.#request(
      `/v1/snapshots/${encodeURIComponent(expectedWorkspaceId)}`,
    );
    const envelope = z
      .object({ data: TaxWidgetSnapshotEnvelopeSchema })
      .passthrough()
      .parse(await safeJson(response));
    if (envelope.data.workspaceId !== expectedWorkspaceId) {
      throw new Error(
        "Tax Automation Engine request failed: TAX_SNAPSHOT_IDENTITY_MISMATCH",
      );
    }
    return envelope.data;
  }

  async listTaxCatalogues(workspaceId: string) {
    const expectedWorkspaceId = TaxSetupWorkspaceIdSchema.parse(workspaceId);
    const response = await this.#request("/v1/catalogues");
    const envelope = await strictBoundedJson(
      response,
      taxCataloguesEnvelopeSchema,
    );
    return {
      version: "tax-setup-operation-result-v1" as const,
      operation: "catalogues" as const,
      workspaceId: expectedWorkspaceId,
      catalogues: envelope.data,
    };
  }

  async getTaxProfile(
    workspaceId: string,
    actorId: string,
    forwardedPrincipal: ForwardedTaxTenantPrincipalHeaders,
  ) {
    const expectedWorkspaceId = TaxSetupWorkspaceIdSchema.parse(workspaceId);
    const expectedActorId = z.string().uuid().parse(actorId);
    const headers = validatedSetupPrincipalHeaders(
      forwardedPrincipal,
      expectedWorkspaceId,
      expectedActorId,
      "profile:read",
    );
    const response = await this.#request(
      `/v1/profiles/${encodeURIComponent(expectedWorkspaceId)}`,
      { headers, acceptedStatuses: [404] },
    );
    if (response.status === 404) {
      await strictBoundedJson(response, taxNotFoundEnvelopeSchema);
      return {
        version: "tax-setup-operation-result-v1" as const,
        operation: "profile_read" as const,
        workspaceId: expectedWorkspaceId,
        profile: null,
      };
    }
    const envelope = await strictBoundedJson(
      response,
      taxProfileEnvelopeSchema,
    );
    if (envelope.data.workspaceId !== expectedWorkspaceId) {
      throw new TaxAutomationRequestError(
        "TAX_SETUP_RESPONSE_IDENTITY_MISMATCH",
        502,
      );
    }
    return {
      version: "tax-setup-operation-result-v1" as const,
      operation: "profile_read" as const,
      workspaceId: expectedWorkspaceId,
      profile: envelope.data,
    };
  }

  async getTaxSnapshotConfiguration(
    workspaceId: string,
    actorId: string,
    projectionKey: string,
    forwardedPrincipal: ForwardedTaxTenantPrincipalHeaders,
  ) {
    const expectedWorkspaceId = TaxSetupWorkspaceIdSchema.parse(workspaceId);
    const expectedActorId = z.string().uuid().parse(actorId);
    const expectedProjectionKey =
      TaxSetupProjectionKeySchema.parse(projectionKey);
    const headers = validatedSetupPrincipalHeaders(
      forwardedPrincipal,
      expectedWorkspaceId,
      expectedActorId,
      "snapshot:configure",
    );
    const response = await this.#request(
      `/v1/snapshot-configurations/${encodeURIComponent(expectedWorkspaceId)}/${encodeURIComponent(expectedProjectionKey)}`,
      { headers, acceptedStatuses: [404] },
    );
    if (response.status === 404) {
      await strictBoundedJson(response, taxNotFoundEnvelopeSchema);
      return {
        version: "tax-setup-operation-result-v1" as const,
        operation: "configuration_read" as const,
        workspaceId: expectedWorkspaceId,
        configuration: null,
      };
    }
    const envelope = await strictBoundedJson(
      response,
      taxConfigurationEnvelopeSchema,
    );
    if (
      envelope.data.configuration.workspaceId !== expectedWorkspaceId ||
      envelope.data.projectionKey !== expectedProjectionKey
    ) {
      throw new TaxAutomationRequestError(
        "TAX_SETUP_RESPONSE_IDENTITY_MISMATCH",
        502,
      );
    }
    return {
      version: "tax-setup-operation-result-v1" as const,
      operation: "configuration_read" as const,
      workspaceId: expectedWorkspaceId,
      configuration: envelope.data,
    };
  }

  async confirmTaxProfile(
    input: Readonly<{
      workspaceId: string;
      actorId: string;
      expectedVersion: string | null;
      profile: TaxSetupProfile;
    }>,
    forwardedPrincipal: ForwardedTaxTenantPrincipalHeaders,
  ) {
    const expectedWorkspaceId = TaxSetupWorkspaceIdSchema.parse(
      input.workspaceId,
    );
    const expectedActorId = z.string().uuid().parse(input.actorId);
    const profile = TaxSetupProfileSchema.parse(input.profile);
    if (profile.workspaceId !== expectedWorkspaceId) {
      throw new TaxAutomationRequestError(
        "TAX_SETUP_REQUEST_IDENTITY_MISMATCH",
        400,
      );
    }
    const headers = validatedSetupPrincipalHeaders(
      forwardedPrincipal,
      expectedWorkspaceId,
      expectedActorId,
      "profile:confirm",
    );
    const response = await this.#request("/v1/profiles/confirm", {
      method: "POST",
      headers,
      body: {
        actorId: expectedActorId,
        expectedVersion: input.expectedVersion,
        profile,
      },
    });
    const envelope = await strictBoundedJson(
      response,
      taxProfileEnvelopeSchema,
    );
    if (envelope.data.workspaceId !== expectedWorkspaceId) {
      throw new TaxAutomationRequestError(
        "TAX_SETUP_RESPONSE_IDENTITY_MISMATCH",
        502,
      );
    }
    return {
      version: "tax-setup-operation-result-v1" as const,
      operation: "profile_confirm" as const,
      workspaceId: expectedWorkspaceId,
      profile: envelope.data,
    };
  }

  async configureTaxSnapshot(
    input: Readonly<{
      workspaceId: string;
      actorId: string;
      projectionKey: string;
      expectedConfigHash: string | null;
      period: Readonly<{ start: string; end: string }>;
      displayCurrency: string;
      dataScope: unknown;
    }>,
    forwardedPrincipal: ForwardedTaxTenantPrincipalHeaders,
  ) {
    const expectedWorkspaceId = TaxSetupWorkspaceIdSchema.parse(
      input.workspaceId,
    );
    const expectedActorId = z.string().uuid().parse(input.actorId);
    const expectedProjectionKey = TaxSetupProjectionKeySchema.parse(
      input.projectionKey,
    );
    const headers = validatedSetupPrincipalHeaders(
      forwardedPrincipal,
      expectedWorkspaceId,
      expectedActorId,
      "snapshot:configure",
    );
    const response = await this.#request(
      `/v1/snapshot-configurations/${encodeURIComponent(expectedWorkspaceId)}/${encodeURIComponent(expectedProjectionKey)}`,
      {
        method: "PUT",
        headers,
        body: {
          actorId: expectedActorId,
          expectedConfigHash: input.expectedConfigHash,
          period: input.period,
          displayCurrency: input.displayCurrency,
          dataScope: input.dataScope,
        },
      },
    );
    const envelope = await strictBoundedJson(
      response,
      taxConfigurationWriteEnvelopeSchema,
    );
    const { replayed, ...configuration } = envelope.data;
    if (
      configuration.configuration.workspaceId !== expectedWorkspaceId ||
      configuration.projectionKey !== expectedProjectionKey
    ) {
      throw new TaxAutomationRequestError(
        "TAX_SETUP_RESPONSE_IDENTITY_MISMATCH",
        502,
      );
    }
    return {
      version: "tax-setup-operation-result-v1" as const,
      operation: "configuration_put" as const,
      workspaceId: expectedWorkspaceId,
      configuration,
      replayed,
    };
  }

  /**
   * Dormant V1 browser-contract reader. It intentionally lives beside the
   * legacy snapshot reader until the cross-repository rollout is complete.
   * The frozen package owns every response shape; OA only validates the
   * request-scoped principal before forwarding it to Tax.
   */
  async getBrowserSnapshot(
    workspaceId: string,
    actorId: string,
    forwardedPrincipal: ForwardedTaxTenantPrincipalHeaders,
    projectionKey?: string,
  ): Promise<TaxSnapshotReadResultV1> {
    const expectedWorkspaceId = safeReferenceSchema.parse(workspaceId);
    const expectedActorId = z.string().min(1).max(300).parse(actorId);
    const encodedPrincipal = forwardedPrincipal?.["x-tax-tenant-principal"];
    const signature = forwardedPrincipal?.["x-tax-tenant-signature"];
    validateForwardedTaxTenantPrincipal(
      encodedPrincipal,
      signature,
      expectedWorkspaceId,
      expectedActorId,
      "snapshot:read",
    );
    const expectedProjectionKey = projectionKeySchema.parse(
      projectionKey ?? "default",
    );
    const response = await this.#request(
      `/v1/browser/snapshots/${encodeURIComponent(expectedWorkspaceId)}${
        projectionKey === undefined
          ? ""
          : `/${encodeURIComponent(expectedProjectionKey)}`
      }`,
      {
        headers: {
          "x-tax-tenant-principal": encodedPrincipal,
          "x-tax-tenant-signature": signature,
        },
        acceptedStatuses: [404, 409, 410],
      },
    );
    let result: TaxSnapshotReadResultV1;
    try {
      result = taxSnapshotReadResultV1Schema.parse(await safeJson(response));
    } catch {
      throw new TaxAutomationRequestError(
        "TAX_BROWSER_SNAPSHOT_RESPONSE_INVALID",
        502,
      );
    }
    if (response.status === 200) {
      if (!result.ok || result.data.projectionKey !== expectedProjectionKey)
        throw new TaxAutomationRequestError(
          "TAX_BROWSER_SNAPSHOT_RESPONSE_INVALID",
          502,
        );
    } else if (result.ok || result.problem.status !== response.status) {
      throw new TaxAutomationRequestError(
        "TAX_BROWSER_SNAPSHOT_RESPONSE_INVALID",
        502,
      );
    }
    return result;
  }

  async getAccountantPortfolio(
    accountantOrganizationId: string,
    actorId: string,
    forwardedPrincipal: ForwardedTaxTenantPrincipalHeaders,
  ): Promise<AccountantPortfolioProjection> {
    const expectedOrganizationId = safeReferenceSchema.parse(
      accountantOrganizationId,
    );
    const expectedActorId = z.string().min(1).max(300).parse(actorId);
    const encodedPrincipal = forwardedPrincipal?.["x-tax-tenant-principal"];
    const signature = forwardedPrincipal?.["x-tax-tenant-signature"];
    validateForwardedTaxTenantPrincipal(
      encodedPrincipal,
      signature,
      expectedOrganizationId,
      expectedActorId,
      "accountant:portfolio",
    );
    const response = await this.#request("/v1/accountant-portfolio", {
      headers: {
        "x-tax-tenant-principal": encodedPrincipal,
        "x-tax-tenant-signature": signature,
      },
    });
    try {
      const envelope = z
        .object({ data: AccountantPortfolioProjectionSchema })
        .strict()
        .parse(await safeJson(response));
      if (
        envelope.data.accountantOrganizationId !== expectedOrganizationId ||
        envelope.data.accountantActorId !== expectedActorId
      ) {
        throw new Error("identity mismatch");
      }
      return envelope.data;
    } catch {
      throw new TaxAutomationRequestError(
        "TAX_ACCOUNTANT_PORTFOLIO_RESPONSE_INVALID",
        502,
      );
    }
  }

  async getAccountantReviewQueue(
    accountantOrganizationId: string,
    actorId: string,
    forwardedPrincipal: ForwardedTaxTenantPrincipalHeaders,
  ): Promise<AccountantReviewQueueV1> {
    const expectedOrganizationId = safeReferenceSchema.parse(
      accountantOrganizationId,
    );
    const expectedActorId = z.string().min(1).max(300).parse(actorId);
    const encodedPrincipal = forwardedPrincipal?.["x-tax-tenant-principal"];
    const signature = forwardedPrincipal?.["x-tax-tenant-signature"];
    validateForwardedTaxTenantPrincipal(
      encodedPrincipal,
      signature,
      expectedOrganizationId,
      expectedActorId,
      "accountant:review-queue",
    );
    const response = await this.#request("/v1/accountant-review-queue", {
      headers: {
        "x-tax-tenant-principal": encodedPrincipal,
        "x-tax-tenant-signature": signature,
      },
    });
    try {
      const envelope = accountantReviewQueueEnvelopeV1Schema.parse(
        await safeJson(response),
      );
      if (
        envelope.data.accountantOrganizationId !== expectedOrganizationId ||
        envelope.data.accountantActorId !== expectedActorId
      ) {
        throw new Error("identity mismatch");
      }
      return envelope.data;
    } catch {
      throw new TaxAutomationRequestError(
        "TAX_ACCOUNTANT_REVIEW_QUEUE_RESPONSE_INVALID",
        502,
      );
    }
  }

  /**
   * Reads the browser-safe Factura E factoring projection. This is deliberately
   * read-only: offer acceptance and consent remain separate, authorized commands.
   */
  async getBrowserFactoringProjection(
    workspaceId: string,
    actorId: string,
    forwardedPrincipal: ForwardedTaxTenantPrincipalHeaders,
    projectionKey?: string,
  ): Promise<FacturaEFactoringProjectionReadResultV1> {
    const expectedWorkspaceId = safeReferenceSchema.parse(workspaceId);
    const expectedActorId = z.string().min(1).max(300).parse(actorId);
    const encodedPrincipal = forwardedPrincipal?.["x-tax-tenant-principal"];
    const signature = forwardedPrincipal?.["x-tax-tenant-signature"];
    validateForwardedTaxTenantPrincipal(
      encodedPrincipal,
      signature,
      expectedWorkspaceId,
      expectedActorId,
      "tax.factoring.read",
    );
    const expectedProjectionKey = projectionKeySchema.parse(
      projectionKey ?? "default",
    );
    const response = await this.#request(
      `/v1/browser/factoring-projections/${encodeURIComponent(expectedWorkspaceId)}${
        projectionKey === undefined
          ? ""
          : `/${encodeURIComponent(expectedProjectionKey)}`
      }`,
      {
        headers: {
          "x-tax-tenant-principal": encodedPrincipal,
          "x-tax-tenant-signature": signature,
        },
        acceptedStatuses: [404],
      },
    );
    let result: FacturaEFactoringProjectionReadResultV1;
    try {
      result = facturaEFactoringProjectionReadResultV1Schema.parse(
        await safeJson(response),
      );
    } catch {
      throw new TaxAutomationRequestError(
        "TAX_FACTORING_PROJECTION_RESPONSE_INVALID",
        502,
      );
    }
    if (response.status === 200) {
      if (
        result.state !== "ready" ||
        result.receipt.projectionKey !== expectedProjectionKey
      )
        throw new TaxAutomationRequestError(
          "TAX_FACTORING_PROJECTION_RESPONSE_INVALID",
          502,
        );
    } else if (result.state !== "unavailable") {
      throw new TaxAutomationRequestError(
        "TAX_FACTORING_PROJECTION_RESPONSE_INVALID",
        502,
      );
    }
    return result;
  }

  async getCopilotPacket(
    runId: string,
    key: string,
    workspaceId: string,
  ): Promise<Record<string, unknown>> {
    const result = await this.#invoke(
      "tax_ar_factura_e_get_copilot_packet",
      workspaceId,
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
    workspaceId: string,
  ): Promise<Record<string, unknown>> {
    const result = await this.#invoke(
      "tax_ar_factura_e_get_accounting_attestation_packet",
      workspaceId,
      "agent:tax",
      `${key}:attestation`,
      { runId },
    );
    return mutationData(result);
  }

  async #invoke(
    toolId: string,
    workspaceId: string,
    actorId: string,
    idempotencyKey: string,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    const path = `/v1/agent/tools/${toolId}/invoke`;
    const body = { actorId, idempotencyKey, input };
    const rawBody = JSON.stringify(body);
    const response = await this.#request(path, {
      method: "POST",
      rawBody,
      headers: taxAgentPrincipalHeaders({
        secret: this.#agentPrincipalSecret,
        workspaceId,
        actorId,
        toolId,
        path,
        rawBody,
        idempotencyKey,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    });
    return safeJson(response);
  }

  async #request(
    path: string,
    options: Readonly<{
      method?: "GET" | "POST" | "PUT";
      headers?: Record<string, string>;
      body?: unknown;
      rawBody?: string;
      acceptedStatuses?: readonly number[];
    }> = {},
  ): Promise<Response> {
    const response = await this.#fetch(new URL(path, this.#baseUrl), {
      method: options.method ?? "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${this.#agentApiKey}`,
        ...(options.body === undefined && options.rawBody === undefined
          ? {}
          : { "content-type": "application/json" }),
        ...options.headers,
      },
      ...(options.body === undefined && options.rawBody === undefined
        ? {}
        : { body: options.rawBody ?? JSON.stringify(options.body) }),
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok && !options.acceptedStatuses?.includes(response.status)) {
      let code = `HTTP_${response.status}`;
      try {
        const payload = await strictBoundedJson(
          response,
          taxErrorEnvelopeSchema,
          64 * 1024,
        );
        code = payload.error;
      } catch {
        // Preserve only status when the upstream error is malformed or too
        // large. Error bodies are never required for setup correctness.
      }
      throw new TaxAutomationRequestError(code, response.status);
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
    const handoff = await client.getCopilotPacket(
      runId,
      input.idempotencyKey,
      input.workspaceId,
    );
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
      input.workspaceId,
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
    taxpayerReferenceHash: run.intent?.taxpayerReferenceHash ?? null,
    foreignCustomerReferenceHash:
      run.intent?.foreignCustomerReferenceHash ?? null,
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
  try {
    return await readBoundedJsonResponse(response, 512 * 1024);
  } catch {
    throw new Error("Tax Automation Engine returned invalid JSON data");
  }
}

async function readBoundedJsonResponse(
  response: Response,
  maximumBytes: number,
): Promise<unknown> {
  const contentType = response.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== "application/json") throw new Error("CONTENT_TYPE");
  const declared = response.headers.get("content-length");
  if (declared !== null) {
    if (!/^\d+$/.test(declared)) throw new Error("CONTENT_LENGTH");
    const count = Number(declared);
    if (!Number.isSafeInteger(count) || count > maximumBytes)
      throw new Error("BODY_TOO_LARGE");
  }
  if (!response.body) throw new Error("BODY_MISSING");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        throw new Error("BODY_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return JSON.parse(text) as unknown;
}

async function strictBoundedJson<T>(
  response: Response,
  schema: z.ZodType<T>,
  maximumBytes = 512 * 1024,
): Promise<T> {
  try {
    return schema.parse(await readBoundedJsonResponse(response, maximumBytes));
  } catch (error) {
    if (error instanceof TaxAutomationRequestError) throw error;
    throw new TaxAutomationRequestError("TAX_SETUP_UPSTREAM_INVALID", 502);
  }
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
