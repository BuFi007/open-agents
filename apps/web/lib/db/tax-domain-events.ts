import type { TaxDomainEventV1 } from "@open-agents/tax-automation";
import { and, eq } from "drizzle-orm";

import { db } from "./client";
import {
  taxDomainEventDeliveries,
  taxInvoiceBindings,
} from "./schema";

export class TaxDomainEventDeliveryConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaxDomainEventDeliveryConflictError";
  }
}

/**
 * Store incoming external truth before waking a workflow. `caseRef` is an
 * opaque Tax Engine run reference; it is never resolved from invoice/provider
 * data and only binds when the existing workspace-scoped TaxCase binding agrees.
 */
export async function receiveTaxDomainEventDelivery(input: {
  event: TaxDomainEventV1;
  requestHash: string;
}) {
  return db.transaction(async (transaction) => {
    const binding = input.event.caseRef
      ? await transaction.query.taxInvoiceBindings.findFirst({
          where: and(
            eq(taxInvoiceBindings.workspaceId, input.event.workspaceId),
            eq(taxInvoiceBindings.taxRunId, input.event.caseRef),
          ),
        })
      : undefined;
    const [created] = await transaction
      .insert(taxDomainEventDeliveries)
      .values({
        eventId: input.event.eventId,
        workspaceId: input.event.workspaceId,
        caseRef: input.event.caseRef,
        operatingPackRunId: binding?.operatingPackRunId ?? null,
        taxRunId: binding?.taxRunId ?? null,
        kind: input.event.kind,
        idempotencyKey: input.event.idempotencyKey,
        requestHash: input.requestHash,
        payload: input.event,
        status: binding ? "received" : "waiting_for_case",
      })
      .onConflictDoNothing()
      .returning();
    const delivery =
      created ??
      (await transaction.query.taxDomainEventDeliveries.findFirst({
        where: eq(taxDomainEventDeliveries.eventId, input.event.eventId),
      }));
    if (!delivery)
      throw new TaxDomainEventDeliveryConflictError(
        "Tax domain event identity conflicts with another replay",
      );
    if (
      delivery.workspaceId !== input.event.workspaceId ||
      delivery.requestHash !== input.requestHash ||
      delivery.idempotencyKey !== input.event.idempotencyKey ||
      delivery.kind !== input.event.kind
    )
      throw new TaxDomainEventDeliveryConflictError(
        "Tax domain event idempotency conflict",
      );
    return { delivery, binding, created: Boolean(created) };
  });
}

export async function markTaxDomainEventWoken(input: {
  eventId: string;
  operatingPackRunId: string;
  taxRunId: string;
}) {
  const [delivery] = await db
    .update(taxDomainEventDeliveries)
    .set({
      operatingPackRunId: input.operatingPackRunId,
      taxRunId: input.taxRunId,
      status: "woken",
      wokenAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(taxDomainEventDeliveries.eventId, input.eventId))
    .returning();
  if (!delivery) throw new Error("Tax domain event delivery disappeared");
  return delivery;
}
