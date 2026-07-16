import { timingSafeEqual } from "node:crypto";
import { TaxAutomationClient, TaxAutomationRequestError } from "@open-agents/tax-automation";
import { z } from "zod";

import { readBoundedJson } from "@/lib/http/bounded-json";
import { verifyDeskWorkspaceGrant } from "@/lib/operating-packs/desk-grant";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";

const requestSchema = z.object({
  version: z.literal("bufi-tax-invoice-human-approval-v1"),
  workspaceId: z.string().uuid(),
  actorId: z.string().uuid(),
  taxRunId: z.string().uuid(),
  intentHash: z.string().regex(/^[a-f0-9]{64}$/),
  decision: z.literal("approved"),
  acknowledgement: z.literal("frozen_tax_intent_reviewed"),
  idempotencyKey: z.string().uuid(),
}).strict();

export async function POST(request: Request) {
  if (!authorized(request)) return privateJson({ error: "Unauthorized" }, 401);
  const parsed = requestSchema.safeParse(
    await readBoundedJson(request, 4 * 1024).catch(() => null),
  );
  if (!parsed.success) return privateJson({ error: "Invalid approval request" }, 400);
  const grant = verifyDeskWorkspaceGrant({
    token: request.headers.get("x-bufi-workspace-grant") ?? "",
    workspaceId: parsed.data.workspaceId,
  });
  if (
    !grant ||
    grant.subject !== parsed.data.actorId ||
    !grant.scopes.includes("tax.invoice.intent.approve")
  ) return privateJson({ error: "Invalid workspace grant" }, 403);
  const limited = await checkRateLimit({
    key: rateLimitKey(["bufi-tax-invoice-approval", parsed.data.actorId, parsed.data.taxRunId]),
    limit: 10,
    windowMs: 60_000,
  });
  if (limited) return limited;
  try {
    const client = new TaxAutomationClient({
      baseUrl: process.env.TAX_AUTOMATION_ENGINE_URL ?? "",
      agentApiKey: process.env.TAX_AUTOMATION_ENGINE_API_KEY ?? "",
      agentPrincipalSecret: process.env.TAX_AUTOMATION_ENGINE_AGENT_PRINCIPAL_HMAC_SECRET ?? "",
      userApprovalToken: process.env.TAX_AUTOMATION_ENGINE_USER_APPROVAL_TOKEN ?? "",
    });
    const run = await client.approveInvoiceIntent({
      workspaceId: parsed.data.workspaceId,
      actorId: parsed.data.actorId,
      runId: parsed.data.taxRunId,
      intentHash: parsed.data.intentHash,
      idempotencyKey: parsed.data.idempotencyKey,
    });
    return privateJson({
      data: {
        version: "bufi-tax-invoice-human-approval-receipt-v1",
        workspaceId: run.workspaceId,
        taxRunId: run.runId,
        intentHash: run.intentHash,
        approvalState: run.approvalState,
        issuanceState: run.issuanceState,
      },
    }, 200);
  } catch (error) {
    if (error instanceof TaxAutomationRequestError)
      return privateJson({ error: error.code }, error.status);
    return privateJson({ error: "TAX_INVOICE_APPROVAL_UNAVAILABLE" }, 503);
  }
}

function authorized(request: Request): boolean {
  const secret = process.env.OPEN_AGENTS_BUFI_INGRESS_SECRET;
  const actual = request.headers.get("authorization");
  if (!secret || secret.length < 32 || !actual) return false;
  const expected = `Bearer ${secret}`;
  return actual.length === expected.length
    && timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

function privateJson(value: unknown, status: number): Response {
  return Response.json(value, {
    status,
    headers: { "cache-control": "private, no-store", "x-content-type-options": "nosniff" },
  });
}
