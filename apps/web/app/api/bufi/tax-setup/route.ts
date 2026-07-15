import { timingSafeEqual } from "node:crypto";
import {
  TaxAutomationClient,
  TaxAutomationRequestError,
  TaxSetupOperationRequestSchema,
  TaxSetupOperationResultSchema,
  type ForwardedTaxTenantPrincipalHeaders,
} from "@open-agents/tax-automation";
import { type NextRequest, NextResponse } from "next/server";

import { verifyDeskWorkspaceGrant } from "@/lib/operating-packs/desk-grant";
import { readBoundedJson } from "@/lib/http/bounded-json";

const MAX_REQUEST_BYTES = 256 * 1024;

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

function privateJson(body: unknown, status: number) {
  return NextResponse.json(body, {
    status,
    headers: {
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function principal(request: NextRequest): ForwardedTaxTenantPrincipalHeaders {
  return {
    "x-tax-tenant-principal":
      request.headers.get("x-tax-tenant-principal") ?? "",
    "x-tax-tenant-signature":
      request.headers.get("x-tax-tenant-signature") ?? "",
  };
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return privateJson({ error: "Unauthorized" }, 401);

  let raw: unknown;
  try {
    raw = await readBoundedJson(request, MAX_REQUEST_BYTES);
  } catch {
    return privateJson({ error: "Invalid tax setup request" }, 400);
  }
  const parsed = TaxSetupOperationRequestSchema.safeParse(raw);
  if (!parsed.success)
    return privateJson({ error: "Invalid tax setup request" }, 400);

  const requiredGrantScope =
    parsed.data.operation === "catalogues" ||
    parsed.data.operation === "profile_read" ||
    parsed.data.operation === "configuration_read"
      ? "tax.setup.read"
      : parsed.data.operation === "profile_confirm"
        ? "tax.profile.confirm"
        : "tax.snapshot.configure";
  const grant = verifyDeskWorkspaceGrant({
    token: request.headers.get("x-bufi-workspace-grant") ?? "",
    workspaceId: parsed.data.workspaceId,
  });
  if (
    !grant ||
    grant.subject !== parsed.data.actorId ||
    !grant.scopes.includes(requiredGrantScope)
  )
    return privateJson({ error: "Invalid workspace grant" }, 403);

  try {
    const tax = client();
    const result = await (async () => {
      switch (parsed.data.operation) {
        case "catalogues":
          return tax.listTaxCatalogues(parsed.data.workspaceId);
        case "profile_read":
          return tax.getTaxProfile(
            parsed.data.workspaceId,
            parsed.data.actorId,
            principal(request),
          );
        case "configuration_read":
          return tax.getTaxSnapshotConfiguration(
            parsed.data.workspaceId,
            parsed.data.actorId,
            parsed.data.projectionKey,
            principal(request),
          );
        case "profile_confirm":
          return tax.confirmTaxProfile(parsed.data, principal(request));
        case "configuration_put":
          return tax.configureTaxSnapshot(parsed.data, principal(request));
      }
    })();
    return privateJson(TaxSetupOperationResultSchema.parse(result), 200);
  } catch (error) {
    if (error instanceof TaxAutomationRequestError) {
      if (error.status === 403)
        return privateJson({ error: "TAX_SETUP_FORBIDDEN" }, 403);
      if (error.status === 400)
        return privateJson({ error: "TAX_SETUP_INVALID" }, 400);
      if (error.status === 409)
        return privateJson({ error: "TAX_SETUP_CONFLICT" }, 409);
      if (error.status === 502)
        return privateJson({ error: "TAX_SETUP_UPSTREAM_INVALID" }, 502);
    }
    return privateJson({ error: "TAX_SETUP_UPSTREAM_UNAVAILABLE" }, 503);
  }
}
