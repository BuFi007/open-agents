import { TaxAutomationRequestError } from "@open-agents/tax-automation";

import { requireAuthenticatedUser } from "@/app/api/chat/_lib/chat-context";
import { readBoundedJson } from "@/lib/http/bounded-json";
import { verifyDeskWorkspaceGrant } from "@/lib/operating-packs/desk-grant";
import {
  HumanFacturaEAuthorityApprovalSchema,
  registerHumanFacturaEAuthorityApproval,
} from "@/lib/operating-packs/tax-authority-approval";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";

const MAX_REQUEST_BYTES = 4 * 1024;
const MAX_WORKSPACE_GRANT_CHARACTERS = 4 * 1024;

export async function POST(request: Request) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;
  if (!isSameOrigin(request))
    return privateJson({ error: "Invalid request origin" }, 403);
  if (
    request.headers.get("content-type")?.split(";", 1)[0]?.trim() !==
    "application/json"
  )
    return privateJson({ error: "Invalid approval request" }, 415);

  const parsed = HumanFacturaEAuthorityApprovalSchema.safeParse(
    await readBoundedJson(request, MAX_REQUEST_BYTES).catch(() => null),
  );
  if (!parsed.success)
    return privateJson({ error: "Invalid approval request" }, 400);

  const limited = await checkRateLimit({
    key: rateLimitKey([
      "tax-authority-human-approval",
      auth.userId,
      parsed.data.workspaceId,
      parsed.data.executionId,
    ]),
    limit: 10,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const workspaceGrant = request.headers.get("x-bufi-workspace-grant") ?? "";
  if (
    workspaceGrant.length < 80 ||
    workspaceGrant.length > MAX_WORKSPACE_GRANT_CHARACTERS
  )
    return privateJson({ error: "Invalid workspace grant" }, 403);
  const grant = verifyDeskWorkspaceGrant({
    token: workspaceGrant,
    workspaceId: parsed.data.workspaceId,
  });
  if (
    !grant ||
    grant.subject !== auth.userId ||
    !grant.scopes.includes("tax.invoice.authority.approve")
  )
    return privateJson({ error: "Invalid workspace grant" }, 403);

  try {
    const receipt = await registerHumanFacturaEAuthorityApproval({
      ...parsed.data,
      actorId: auth.userId,
    });
    return privateJson({ data: receipt }, 200);
  } catch (error) {
    if (error instanceof TaxAutomationRequestError) {
      const code = /^[A-Z0-9_]{1,120}$/.test(error.code)
        ? error.code
        : "TAX_AUTHORITY_APPROVAL_FAILED";
      const status = [400, 403, 404, 409, 422, 502, 503].includes(error.status)
        ? error.status
        : 503;
      return privateJson({ error: code }, status);
    }
    return privateJson({ error: "TAX_AUTHORITY_APPROVAL_UNAVAILABLE" }, 503);
  }
}

function isSameOrigin(request: Request): boolean {
  const suppliedOrigin = request.headers.get("origin");
  if (!suppliedOrigin) return false;
  try {
    return new URL(suppliedOrigin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
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
