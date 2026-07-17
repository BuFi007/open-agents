import { timingSafeEqual } from "node:crypto";
import {
  AccountantPortfolioReadRequestSchema,
  TaxAutomationClient,
  TaxAutomationRequestError,
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
  return (
    actual.length === expected.length &&
    timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
  );
}

function client(): TaxAutomationClient {
  return new TaxAutomationClient({
    baseUrl: process.env.TAX_AUTOMATION_ENGINE_URL ?? "",
    agentApiKey: process.env.TAX_AUTOMATION_ENGINE_API_KEY ?? "",
    agentPrincipalSecret:
      process.env.TAX_AUTOMATION_ENGINE_AGENT_PRINCIPAL_HMAC_SECRET ?? "",
  });
}

export async function POST(request: NextRequest) {
  if (!authorized(request))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = AccountantPortfolioReadRequestSchema.safeParse(
    await readBoundedJson(request, MAX_REQUEST_BYTES).catch(() => null),
  );
  if (!parsed.success)
    return NextResponse.json(
      { error: "Invalid portfolio request" },
      { status: 400 },
    );
  const grant = verifyDeskWorkspaceGrant({
    token: request.headers.get("x-bufi-workspace-grant") ?? "",
    workspaceId: parsed.data.workspaceId,
  });
  if (
    !grant ||
    grant.subject !== parsed.data.actorId ||
    !grant.scopes.includes("tax.accountant.portfolio.read")
  ) {
    return NextResponse.json(
      { error: "Invalid workspace grant" },
      { status: 403 },
    );
  }
  try {
    const data = await client().getAccountantPortfolio(
      parsed.data.workspaceId,
      parsed.data.actorId,
      {
        "x-tax-tenant-principal":
          request.headers.get("x-tax-tenant-principal") ?? "",
        "x-tax-tenant-signature":
          request.headers.get("x-tax-tenant-signature") ?? "",
      },
    );
    return NextResponse.json(
      { data },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    if (error instanceof TaxAutomationRequestError && error.status === 403) {
      return NextResponse.json(
        { error: "TAX_ACCOUNTANT_PORTFOLIO_FORBIDDEN" },
        { status: 403 },
      );
    }
    return NextResponse.json(
      { error: "TAX_ACCOUNTANT_PORTFOLIO_UNAVAILABLE" },
      { status: 503 },
    );
  }
}
