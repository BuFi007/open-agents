import { timingSafeEqual } from "node:crypto";
import {
  TaxAutomationClient,
  TaxAutomationRequestError,
  TaxFactoringProjectionReadRequestSchema,
} from "@open-agents/tax-automation";
import { type NextRequest, NextResponse } from "next/server";

import { readBoundedJson } from "@/lib/http/bounded-json";
import { verifyDeskWorkspaceGrant } from "@/lib/operating-packs/desk-grant";

const MAX_REQUEST_BYTES = 16 * 1024;

function authorized(request: NextRequest): boolean {
  const secret = process.env.OPEN_AGENTS_BUFI_INGRESS_SECRET;
  const actual = request.headers.get("authorization");
  if (!secret || secret.length < 32 || !actual) return false;
  const expected = `Bearer ${secret}`;
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

function client(): TaxAutomationClient {
  return new TaxAutomationClient({
    baseUrl: process.env.TAX_AUTOMATION_ENGINE_URL ?? "",
    agentApiKey: process.env.TAX_AUTOMATION_ENGINE_API_KEY ?? "",
    agentPrincipalSecret:
      process.env.TAX_AUTOMATION_ENGINE_AGENT_PRINCIPAL_HMAC_SECRET ?? "",
  });
}

function privateJson(value: unknown, status: number) {
  return NextResponse.json(value, {
    status,
    headers: { "cache-control": "private, no-store" },
  });
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return privateJson({ error: "Unauthorized" }, 401);

  const parsed = TaxFactoringProjectionReadRequestSchema.safeParse(
    await readBoundedJson(request, MAX_REQUEST_BYTES).catch(() => null),
  );
  if (!parsed.success)
    return privateJson(
      { error: "Invalid Tax factoring projection request" },
      400,
    );

  const grant = verifyDeskWorkspaceGrant({
    token: request.headers.get("x-bufi-workspace-grant") ?? "",
    workspaceId: parsed.data.workspaceId,
  });
  if (
    !grant ||
    grant.subject !== parsed.data.actorId ||
    !grant.scopes.includes("tax.factoring.read")
  )
    return privateJson({ error: "Invalid workspace grant" }, 403);

  try {
    const result = await client().getBrowserFactoringProjection(
      parsed.data.workspaceId,
      parsed.data.actorId,
      {
        "x-tax-tenant-principal":
          request.headers.get("x-tax-tenant-principal") ?? "",
        "x-tax-tenant-signature":
          request.headers.get("x-tax-tenant-signature") ?? "",
      },
      parsed.data.projectionKey,
    );
    return privateJson(result, result.state === "ready" ? 200 : 404);
  } catch (error) {
    if (error instanceof TaxAutomationRequestError) {
      if (error.status === 403)
        return privateJson(
          {
            error: [
              "TAX_SNAPSHOT_PRINCIPAL_INVALID",
              "TAX_SNAPSHOT_PRINCIPAL_SCOPE_MISMATCH",
            ].includes(error.code)
              ? error.code
              : "TAX_FACTORING_PROJECTION_FORBIDDEN",
          },
          403,
        );
      if (error.status === 502)
        return privateJson(
          { error: "TAX_FACTORING_PROJECTION_UPSTREAM_INVALID" },
          502,
        );
    }
    return privateJson(
      { error: "TAX_FACTORING_PROJECTION_UPSTREAM_UNAVAILABLE" },
      503,
    );
  }
}
