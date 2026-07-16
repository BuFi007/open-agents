import { timingSafeEqual } from "node:crypto";
import { TaxAutomationRequestError } from "@open-agents/tax-automation";
import { z } from "zod";

import { readBoundedJson } from "@/lib/http/bounded-json";
import { verifyDeskWorkspaceGrant } from "@/lib/operating-packs/desk-grant";
import {
  HumanFacturaEAuthorityApprovalSchema,
  registerHumanFacturaEAuthorityApproval,
} from "@/lib/operating-packs/tax-authority-approval";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";

const MAX_REQUEST_BYTES = 4 * 1024;
const requestSchema = HumanFacturaEAuthorityApprovalSchema.extend({
  actorId: z.string().uuid(),
}).strict();

/**
 * Desk B2B approval ingress. The human click is authenticated and authorized
 * in Desk; Open Agents independently verifies the short-lived workspace grant
 * before deriving its server-held, one-use approval reference.
 */
export async function POST(request: Request) {
  if (!authorized(request)) return privateJson({ error: "Unauthorized" }, 401);
  const parsed = requestSchema.safeParse(
    await readBoundedJson(request, MAX_REQUEST_BYTES).catch(() => null),
  );
  if (!parsed.success)
    return privateJson({ error: "Invalid approval request" }, 400);
  const grant = verifyDeskWorkspaceGrant({
    token: request.headers.get("x-bufi-workspace-grant") ?? "",
    workspaceId: parsed.data.workspaceId,
  });
  if (
    !grant ||
    grant.subject !== parsed.data.actorId ||
    !grant.scopes.includes("tax.invoice.authority.approve")
  )
    return privateJson({ error: "Invalid workspace grant" }, 403);
  const limited = await checkRateLimit({
    key: rateLimitKey([
      "bufi-tax-authority-approval",
      parsed.data.actorId,
      parsed.data.workspaceId,
      parsed.data.executionId,
    ]),
    limit: 10,
    windowMs: 60_000,
  });
  if (limited) return limited;
  try {
    const { actorId, ...decision } = parsed.data;
    const receipt = await registerHumanFacturaEAuthorityApproval({
      ...decision,
      actorId,
    });
    return privateJson({ data: receipt }, 200);
  } catch (error) {
    if (error instanceof TaxAutomationRequestError) {
      return privateJson(
        {
          error: /^[A-Z0-9_]{1,120}$/.test(error.code)
            ? error.code
            : "TAX_AUTHORITY_APPROVAL_FAILED",
        },
        [400, 403, 404, 409, 422, 502, 503].includes(error.status)
          ? error.status
          : 503,
      );
    }
    return privateJson({ error: "TAX_AUTHORITY_APPROVAL_UNAVAILABLE" }, 503);
  }
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
