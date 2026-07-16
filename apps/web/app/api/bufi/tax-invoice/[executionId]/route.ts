import { timingSafeEqual } from "node:crypto";
import { z } from "zod";

import { getOperatingPackRun } from "@/lib/db/operating-pack-runs";
import { deskBridgeUserId } from "@/lib/operating-packs/desk-bridge-user";
import { verifyDeskWorkspaceGrant } from "@/lib/operating-packs/desk-grant";

const querySchema = z
  .object({
    workspaceId: z.string().uuid(),
    actorId: z.string().uuid(),
  })
  .strict();

const phaseSchema = z.enum([
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
]);

const checkpointSchema = z
  .object({
    version: z.literal("tax-invoice-workflow-result-v1"),
    taxRunId: z.string().uuid(),
    phase: phaseSchema,
    intentHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    taxpayerReferenceHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    foreignCustomerReferenceHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    nextActions: z.array(z.string().min(1).max(160)).max(30),
    revision: z.number().int().positive(),
    approvalBoundary: z.literal("tax-engine-trusted-channel"),
  })
  .passthrough();

/**
 * Desk-only, grant-scoped status projection for the durable Tax invoice case.
 * It deliberately omits workflow traces, handoff payloads, approvals, and all
 * authority material. Desk receives only the IDs and checkpoint needed to
 * continue the separate Motora authority corridor.
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
    return privateJson({ error: "Invalid tax invoice status request" }, 400);
  const workspaceGrant = request.headers.get("x-bufi-workspace-grant") ?? "";
  const grant = verifyDeskWorkspaceGrant({
    token: workspaceGrant,
    workspaceId: parsed.data.workspaceId,
  });
  if (
    !grant ||
    grant.subject !== parsed.data.actorId ||
    !grant.scopes.includes("tax.invoice.prepare")
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

  const checkpoint =
    run.result === null ? null : checkpointSchema.safeParse(run.result);
  if (checkpoint && !checkpoint.success)
    return privateJson({ error: "Tax invoice checkpoint unavailable" }, 503);
  return privateJson(
    {
      data: {
        version: "bufi-tax-invoice-status-v1",
        executionId: run.id,
        workspaceId: run.workspaceId,
        status: run.status,
        errorCode: run.errorCode,
        checkpoint: checkpoint?.success
          ? {
              version: checkpoint.data.version,
              taxRunId: checkpoint.data.taxRunId,
              phase: checkpoint.data.phase,
              intentHash: checkpoint.data.intentHash,
              taxpayerReferenceHash: checkpoint.data.taxpayerReferenceHash,
              foreignCustomerReferenceHash:
                checkpoint.data.foreignCustomerReferenceHash,
              nextActions: checkpoint.data.nextActions,
              revision: checkpoint.data.revision,
              approvalBoundary: checkpoint.data.approvalBoundary,
            }
          : null,
        updatedAt: run.updatedAt.toISOString(),
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
