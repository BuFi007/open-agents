import { timingSafeEqual } from "node:crypto";
import { z } from "zod";

import { getOperatingPackRun } from "@/lib/db/operating-pack-runs";
import { getTaxInvoiceBindingByOperatingPackRun } from "@/lib/db/tax-settlements";
import { deskBridgeUserId } from "@/lib/operating-packs/desk-bridge-user";
import { verifyDeskWorkspaceGrant } from "@/lib/operating-packs/desk-grant";

const SHA256 = /^[a-f0-9]{64}$/;

const querySchema = z
  .object({
    workspaceId: z.string().uuid(),
    actorId: z.string().uuid(),
  })
  .strict();

const invoiceAuthoritySchema = z
  .object({
    intentHash: z.string().regex(SHA256),
    documentType: z.literal(19),
    pointOfSale: z.number().int().positive().max(99_998),
    invoiceNumber: z.string().regex(/^[1-9]\d{0,7}$/),
    cae: z.string().regex(/^\d{14}$/),
    caeExpiry: z.iso.date(),
    currencyId: z.string().regex(/^[A-Z0-9]{1,3}$/),
    currencyQuote: z.string().regex(/^\d+(?:\.\d{1,6})?$/),
    authorizedAt: z.iso.datetime({ offset: true }),
    authorityReceiptHash: z.string().regex(SHA256),
    issueDate: z.iso.date(),
  })
  .passthrough();

const checkpointSchema = z
  .object({
    version: z.literal("tax-invoice-workflow-result-v1"),
    taxRunId: z.string().uuid(),
    phase: z.enum([
      "authorized",
      "settlement_pending",
      "settlement_attention_required",
      "fx_ingress_review_required",
      "tax_declaration_review_required",
      "accounting_ready",
    ]),
    intentHash: z.string().regex(SHA256),
    revision: z.number().int().positive(),
    approvalBoundary: z.literal("tax-engine-trusted-channel"),
    handoff: z
      .object({
        version: z.literal("factura-e-accounting-attestation-packet-v1"),
        runId: z.string().uuid(),
        workspaceId: z.string().uuid(),
        generatedFromRevision: z.number().int().positive(),
        invoice: invoiceAuthoritySchema,
      })
      .passthrough(),
  })
  .passthrough();

/**
 * Server-only authority projection used by Desk to persist the official CAE on
 * the original ledger invoice. This is deliberately separate from the browser
 * checkpoint route and requires a dedicated, short-lived synchronization grant.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ executionId: string }> },
) {
  if (!authorized(request)) return privateJson({ error: "Unauthorized" }, 401);
  const parsed = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!parsed.success)
    return privateJson(
      { error: "Invalid authority synchronization request" },
      400,
    );
  const grant = verifyDeskWorkspaceGrant({
    token: request.headers.get("x-bufi-workspace-grant") ?? "",
    workspaceId: parsed.data.workspaceId,
  });
  if (
    !grant ||
    grant.subject !== parsed.data.actorId ||
    !grant.scopes.includes("tax.invoice.authority.sync")
  )
    return privateJson({ error: "Invalid workspace grant" }, 403);

  const { executionId } = await context.params;
  if (!/^tax_[A-Za-z0-9_-]{20,80}$/.test(executionId))
    return privateJson({ error: "Run not found" }, 404);
  const run = await getOperatingPackRun(executionId);
  if (
    !run ||
    run.workspaceId !== parsed.data.workspaceId ||
    run.userId !== deskBridgeUserId(grant.subject) ||
    run.packId !== "tax_automation" ||
    run.workflowId !== "ai_invoice_to_factura_e"
  )
    return privateJson({ error: "Run not found" }, 404);

  const checkpoint = checkpointSchema.safeParse(run.result);
  if (!checkpoint.success)
    return privateJson({ error: "Official authority is not available" }, 409);
  const binding = await getTaxInvoiceBindingByOperatingPackRun(
    run.workspaceId,
    run.id,
  );
  const handoff = checkpoint.data.handoff;
  if (
    !binding ||
    binding.taxRunId !== checkpoint.data.taxRunId ||
    handoff.runId !== checkpoint.data.taxRunId ||
    handoff.workspaceId !== run.workspaceId ||
    handoff.invoice.intentHash !== checkpoint.data.intentHash ||
    handoff.generatedFromRevision !== checkpoint.data.revision
  )
    return privateJson({ error: "Official authority binding conflict" }, 409);

  const invoice = handoff.invoice;
  return privateJson(
    {
      data: {
        version: "bufi-tax-invoice-authority-v1",
        executionId: run.id,
        workspaceId: run.workspaceId,
        ledgerInvoiceId: binding.ledgerInvoiceId,
        taxRunId: checkpoint.data.taxRunId,
        intentHash: checkpoint.data.intentHash,
        revision: checkpoint.data.revision,
        invoice: {
          documentType: invoice.documentType,
          pointOfSale: invoice.pointOfSale,
          invoiceNumber: invoice.invoiceNumber,
          cae: invoice.cae,
          caeExpiry: invoice.caeExpiry,
          currencyId: invoice.currencyId,
          currencyQuote: invoice.currencyQuote,
          authorizedAt: invoice.authorizedAt,
          authorityReceiptHash: invoice.authorityReceiptHash,
          issueDate: invoice.issueDate,
        },
      },
    },
    200,
  );
}

function authorized(request: Request): boolean {
  const secret = process.env.OPEN_AGENTS_BUFI_INGRESS_SECRET;
  const actual = request.headers.get("authorization");
  if (!secret || secret.length < 32 || !actual) return false;
  const expected = `Bearer ${secret}`;
  return (
    actual.length === expected.length &&
    timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
  );
}

function privateJson(value: unknown, status: number): Response {
  return Response.json(value, {
    status,
    headers: {
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
