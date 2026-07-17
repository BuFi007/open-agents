import { createHmac, timingSafeEqual } from "node:crypto";
import { TaxDomainEventDeliveryV1Schema } from "@open-agents/tax-automation";
import { type NextRequest, NextResponse } from "next/server";
import { resumeHook } from "workflow/api";

import {
  claimTaxDomainEventTargets,
  completeTaxDomainEventTarget,
  getTaxDomainEventProgress,
  receiveTaxDomainEventDelivery,
  releaseTaxDomainEventTarget,
  TaxDomainEventDeliveryConflictError,
} from "@/lib/db/tax-domain-events";
import { getTaxWorkflowWakeHookToken } from "@/lib/operating-packs/tax-settlement-hook";

const MAX_EVENT_BYTES = 64 * 1024;

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

function signed(request: NextRequest, rawBody: string): boolean {
  const secret = process.env.OPEN_AGENTS_TAX_DOMAIN_EVENT_HMAC_SECRET;
  const supplied = request.headers.get("x-bufi-tax-event-signature");
  if (!secret || Buffer.byteLength(secret) < 32 || !supplied) return false;
  if (!/^[a-f0-9]{64}$/.test(supplied)) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

async function readBoundedBody(request: NextRequest): Promise<string | null> {
  const declared = request.headers.get("content-length");
  if (
    declared &&
    (!/^\d+$/.test(declared) || Number(declared) > MAX_EVENT_BYTES)
  )
    return null;
  const body = await request.text();
  return Buffer.byteLength(body) <= MAX_EVENT_BYTES ? body : null;
}

function receipt(input: {
  deliveryId: string;
  eventId: string;
  payloadHash: string;
  accepted: boolean;
  status: "waiting_for_tax_case" | "woken";
  replayed: boolean;
}) {
  return {
    version: "tax-domain-event-receipt-v1" as const,
    ...input,
  };
}

/**
 * Authenticated Tax Engine ingress. The signed, hash-bound envelope is parsed
 * and persisted before resumeHook. A failed or premature wake is retryable, so
 * the producer outbox retains ownership until a bound Tax workflow is woken.
 */
export async function POST(request: NextRequest) {
  if (!authorized(request))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rawBody = await readBoundedBody(request);
  if (rawBody === null)
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  if (!signed(request, rawBody))
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    body = null;
  }
  const parsed = TaxDomainEventDeliveryV1Schema.safeParse(body);
  if (!parsed.success)
    return NextResponse.json(
      { error: "Invalid privacy-minimized TaxDomainEventV1 delivery" },
      { status: 400 },
    );

  const { deliveryId, event, payloadHash } = parsed.data;
  let received: Awaited<ReturnType<typeof receiveTaxDomainEventDelivery>>;
  try {
    received = await receiveTaxDomainEventDelivery({
      event,
      requestHash: payloadHash,
    });
  } catch (error) {
    if (error instanceof TaxDomainEventDeliveryConflictError)
      return NextResponse.json(
        { error: "Tax domain event idempotency conflict" },
        { status: 409 },
      );
    return NextResponse.json(
      { error: "TAX_DOMAIN_EVENT_PERSISTENCE_UNAVAILABLE" },
      { status: 503 },
    );
  }

  if (received.targets.length === 0)
    return NextResponse.json(
      receipt({
        deliveryId,
        eventId: event.eventId,
        payloadHash,
        accepted: false,
        status: "waiting_for_tax_case",
        replayed: !received.created,
      }),
      { status: 202 },
    );

  if (received.delivery.status === "woken")
    return NextResponse.json(
      receipt({
        deliveryId,
        eventId: event.eventId,
        payloadHash,
        accepted: true,
        status: "woken",
        replayed: true,
      }),
    );

  const now = new Date();
  let claims: Awaited<ReturnType<typeof claimTaxDomainEventTargets>>;
  try {
    claims = await claimTaxDomainEventTargets({
      eventId: event.eventId,
      now,
      leaseUntil: new Date(now.getTime() + 5 * 60_000),
    });
  } catch {
    return NextResponse.json(
      { error: "TAX_DOMAIN_EVENT_PERSISTENCE_UNAVAILABLE" },
      { status: 503 },
    );
  }
  let wakeFailed = false;
  for (const target of claims) {
    if (!target.leaseToken) {
      wakeFailed = true;
      continue;
    }
    try {
      await resumeHook(getTaxWorkflowWakeHookToken(target.operatingPackRunId), {
        eventId: event.eventId,
      });
      await completeTaxDomainEventTarget({
        eventId: event.eventId,
        operatingPackRunId: target.operatingPackRunId,
        leaseToken: target.leaseToken,
      });
    } catch {
      wakeFailed = true;
      try {
        await releaseTaxDomainEventTarget({
          eventId: event.eventId,
          operatingPackRunId: target.operatingPackRunId,
          leaseToken: target.leaseToken,
          errorCode: "TAX_DOMAIN_EVENT_WAKE_UNAVAILABLE",
        });
      } catch {
        // The fenced lease expires and becomes retryable even if the explicit
        // release cannot reach Postgres.
      }
    }
  }

  let progress: Awaited<ReturnType<typeof getTaxDomainEventProgress>>;
  try {
    progress = await getTaxDomainEventProgress(event.eventId);
  } catch {
    return NextResponse.json(
      { error: "TAX_DOMAIN_EVENT_PERSISTENCE_UNAVAILABLE" },
      { status: 503 },
    );
  }
  if (progress.delivery?.status !== "woken") {
    // Every successful target remains durably woken. The producer retains the
    // outbox item and retries only unfinished or expired targets.
    if (!wakeFailed)
      return NextResponse.json(
        receipt({
          deliveryId,
          eventId: event.eventId,
          payloadHash,
          accepted: false,
          status: "waiting_for_tax_case",
          replayed: !received.created,
        }),
        { status: 202 },
      );
    return NextResponse.json(
      { error: "TAX_DOMAIN_EVENT_WAKE_UNAVAILABLE" },
      { status: 503 },
    );
  }

  return NextResponse.json(
    receipt({
      deliveryId,
      eventId: event.eventId,
      payloadHash,
      accepted: true,
      status: "woken",
      replayed: !received.created,
    }),
  );
}
