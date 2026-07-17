import { createHash, timingSafeEqual } from "node:crypto";
import { InvoiceSettlementEventV1Schema } from "@open-agents/tax-automation";
import { type NextRequest, NextResponse } from "next/server";
import { resumeHook } from "workflow/api";
import {
  receiveTaxSettlementDelivery,
  TaxSettlementDeliveryConflictError,
} from "@/lib/db/tax-settlements";
import { verifyDeskWorkspaceGrant } from "@/lib/operating-packs/desk-grant";
import {
  deliverTaxSettlement,
  deliverTaxSettlementDependents,
  TaxSettlementDeliveryError,
} from "@/lib/operating-packs/tax-settlement-delivery";
import {
  getTaxSettlementHookToken,
  TAX_SETTLEMENT_SERVICE_ACTOR_ID,
} from "@/lib/operating-packs/tax-settlement-hook";
import { readBoundedJson } from "@/lib/http/bounded-json";

const MAX_REQUEST_BYTES = 64 * 1024;

function authorized(request: NextRequest): boolean {
  const secret = process.env.OPEN_AGENTS_BUFI_INGRESS_SECRET;
  const actual = request.headers.get("authorization");
  if (!secret || secret.length < 32 || !actual) return false;
  const expected = `Bearer ${secret}`;
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

export async function POST(request: NextRequest) {
  if (!authorized(request))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = InvoiceSettlementEventV1Schema.safeParse(
    await readBoundedJson(request, MAX_REQUEST_BYTES).catch(() => null),
  );
  if (!parsed.success)
    return NextResponse.json(
      { error: "Invalid invoice settlement event" },
      { status: 400 },
    );
  const grant = verifyDeskWorkspaceGrant({
    token: request.headers.get("x-bufi-workspace-grant") ?? "",
    workspaceId: parsed.data.teamId,
  });
  if (
    !grant ||
    grant.subject !== TAX_SETTLEMENT_SERVICE_ACTOR_ID ||
    !grant.scopes.includes("tax.invoice.settlement")
  )
    return NextResponse.json(
      { error: "Invalid workspace grant" },
      { status: 403 },
    );

  const requestHash = createHash("sha256")
    .update(JSON.stringify(parsed.data))
    .digest("hex");
  let received: Awaited<ReturnType<typeof receiveTaxSettlementDelivery>>;
  try {
    received = await receiveTaxSettlementDelivery({
      event: parsed.data,
      requestHash,
    });
  } catch (error) {
    if (!(error instanceof TaxSettlementDeliveryConflictError))
      return NextResponse.json(
        { error: "TAX_SETTLEMENT_PERSISTENCE_UNAVAILABLE" },
        { status: 503 },
      );
    return NextResponse.json(
      { error: "Settlement delivery idempotency conflict" },
      { status: 409 },
    );
  }
  if (received.delivery.status === "completed" && !received.binding)
    return NextResponse.json({
      eventId: parsed.data.eventId,
      status: "completed",
      replayed: true,
    });
  if (received.delivery.status === "processing" && !received.binding)
    return NextResponse.json(
      {
        eventId: parsed.data.eventId,
        status: "processing",
        replayed: true,
      },
      { status: 202 },
    );
  if (!received.binding)
    return NextResponse.json(
      {
        eventId: parsed.data.eventId,
        status: "waiting_for_tax_case",
        replayed: !received.created,
      },
      { status: 202 },
    );

  try {
    const result =
      received.delivery.status === "completed"
        ? ({
            status: "completed",
            replayed: true,
            taxRevision: null,
          } as const)
        : await deliverTaxSettlement({
            event: parsed.data,
            binding: received.binding,
          });
    if (result.status === "completed")
      await deliverTaxSettlementDependents({
        event: parsed.data,
        binding: received.binding,
      });
    await wakeTaxWorkflow(
      received.binding.operatingPackRunId,
      parsed.data.eventId,
    );
    return NextResponse.json(
      {
        eventId: parsed.data.eventId,
        status: result.status,
        replayed:
          result.status === "completed" ? result.replayed : !received.created,
      },
      { status: result.status === "completed" ? 200 : 202 },
    );
  } catch (error) {
    if (error instanceof TaxSettlementDeliveryError)
      return NextResponse.json(
        { error: error.code },
        { status: error.retryable ? 503 : 422 },
      );
    return NextResponse.json(
      { error: "TAX_AUTOMATION_DELIVERY_FAILED" },
      { status: 503 },
    );
  }
}

async function wakeTaxWorkflow(
  operatingPackRunId: string,
  eventId: string,
): Promise<void> {
  try {
    await resumeHook(getTaxSettlementHookToken(operatingPackRunId), {
      eventId,
    });
  } catch {
    // A workflow may be between checkpoints or already terminal. The durable
    // delivery row and Tax Engine mutation remain authoritative in either case.
  }
}
