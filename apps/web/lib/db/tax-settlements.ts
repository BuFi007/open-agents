import {
  type InvoiceSettlementEventV1,
  taxRunIdFor,
} from "@open-agents/tax-automation";
import { and, asc, count, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "./client";
import { taxInvoiceBindings, taxSettlementDeliveries } from "./schema";
import { bindTaxCaseRun } from "./tax-domain-events";
import { receiveTaxSettlementDeliveryWithStore } from "./tax-settlement-receive";

export { TaxSettlementDeliveryConflictError } from "./tax-settlement-receive";

export async function bindTaxInvoiceRun(input: {
  workspaceId: string;
  ledgerInvoiceId: string;
  operatingPackRunId: string;
  idempotencyKey: string;
}) {
  const taxRunId = taxRunIdFor(input.workspaceId, input.idempotencyKey);
  const binding = await db.transaction(async (transaction) => {
    await transaction
      .insert(taxInvoiceBindings)
      .values({
        workspaceId: input.workspaceId,
        ledgerInvoiceId: input.ledgerInvoiceId,
        operatingPackRunId: input.operatingPackRunId,
        taxRunId,
        taxIdempotencyKey: input.idempotencyKey,
      })
      .onConflictDoNothing({
        target: [
          taxInvoiceBindings.workspaceId,
          taxInvoiceBindings.ledgerInvoiceId,
        ],
      });
    const [binding] = await transaction
      .select()
      .from(taxInvoiceBindings)
      .where(
        and(
          eq(taxInvoiceBindings.workspaceId, input.workspaceId),
          eq(taxInvoiceBindings.ledgerInvoiceId, input.ledgerInvoiceId),
        ),
      )
      .limit(1);
    if (!binding) throw new Error("Tax invoice binding was not persisted");
    if (
      binding.operatingPackRunId !== input.operatingPackRunId ||
      binding.taxRunId !== taxRunId ||
      binding.taxIdempotencyKey !== input.idempotencyKey
    )
      throw new Error("Invoice is already bound to another tax case");

    await transaction
      .update(taxSettlementDeliveries)
      .set({
        operatingPackRunId: binding.operatingPackRunId,
        taxRunId: binding.taxRunId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(taxSettlementDeliveries.workspaceId, binding.workspaceId),
          eq(taxSettlementDeliveries.ledgerInvoiceId, binding.ledgerInvoiceId),
          eq(taxSettlementDeliveries.status, "waiting_for_case"),
        ),
      );
    return binding;
  });
  await bindTaxCaseRun({
    workspaceId: binding.workspaceId,
    taxRunId: binding.taxRunId,
    operatingPackRunId: binding.operatingPackRunId,
    caseKind: "invoice",
  });
  return binding;
}

export async function getTaxInvoiceBinding(
  workspaceId: string,
  ledgerInvoiceId: string,
) {
  return db.query.taxInvoiceBindings.findFirst({
    where: and(
      eq(taxInvoiceBindings.workspaceId, workspaceId),
      eq(taxInvoiceBindings.ledgerInvoiceId, ledgerInvoiceId),
    ),
  });
}

export async function getTaxInvoiceBindingByOperatingPackRun(
  workspaceId: string,
  operatingPackRunId: string,
) {
  return db.query.taxInvoiceBindings.findFirst({
    where: and(
      eq(taxInvoiceBindings.workspaceId, workspaceId),
      eq(taxInvoiceBindings.operatingPackRunId, operatingPackRunId),
    ),
  });
}

export async function receiveTaxSettlementDelivery(input: {
  event: InvoiceSettlementEventV1;
  requestHash: string;
}) {
  return receiveTaxSettlementDeliveryWithStore(input, {
    findBinding: getTaxInvoiceBinding,
    insertDelivery: async (delivery) => {
      const [created] = await db
        .insert(taxSettlementDeliveries)
        .values(delivery)
        .onConflictDoNothing()
        .returning();
      return created;
    },
    findDelivery: (eventId) =>
      db.query.taxSettlementDeliveries.findFirst({
        where: eq(taxSettlementDeliveries.eventId, eventId),
      }),
    backfillBinding: async ({
      eventId,
      workspaceId,
      ledgerInvoiceId,
      binding,
    }) => {
      const [delivery] = await db
        .update(taxSettlementDeliveries)
        .set({
          operatingPackRunId: binding.operatingPackRunId,
          taxRunId: binding.taxRunId,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(taxSettlementDeliveries.eventId, eventId),
            eq(taxSettlementDeliveries.workspaceId, workspaceId),
            eq(taxSettlementDeliveries.ledgerInvoiceId, ledgerInvoiceId),
          ),
        )
        .returning();
      return delivery;
    },
  });
}

const TAX_SETTLEMENT_PROCESSING_LEASE_MS = 5 * 60 * 1000;

export async function acquireTaxSettlementProcessing(input: {
  eventId: string;
  operatingPackRunId: string;
  taxRunId: string;
  processingToken: string;
}) {
  const [delivery] = await db
    .update(taxSettlementDeliveries)
    .set({
      operatingPackRunId: input.operatingPackRunId,
      taxRunId: input.taxRunId,
      status: "processing",
      processingToken: input.processingToken,
      processingStartedAt: new Date(),
      attempts: sql`${taxSettlementDeliveries.attempts} + 1`,
      lastErrorCode: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(taxSettlementDeliveries.eventId, input.eventId),
        eq(
          taxSettlementDeliveries.operatingPackRunId,
          input.operatingPackRunId,
        ),
        eq(taxSettlementDeliveries.taxRunId, input.taxRunId),
        retryableSettlementStatus(),
      ),
    )
    .returning();
  if (delivery) return { state: "acquired" as const, delivery };
  const current = await findTaxSettlementDelivery(input.eventId);
  if (!current) throw new Error("Settlement delivery was not found");
  if (
    current.operatingPackRunId !== input.operatingPackRunId ||
    current.taxRunId !== input.taxRunId
  )
    throw new Error("Settlement delivery tax-case identity changed");
  if (current.status === "completed")
    return { state: "completed" as const, delivery: current };
  if (current.status === "processing")
    return { state: "processing" as const, delivery: current };
  throw new Error("Settlement delivery processing claim was not acquired");
}

export function markTaxSettlementCompleted(
  eventId: string,
  processingToken: string,
) {
  return transitionTaxSettlementProcessing({
    eventId,
    processingToken,
    status: "completed",
    errorCode: null,
  });
}

export async function markTaxSettlementWaiting(
  eventId: string,
  processingToken: string,
  errorCode: string | null,
) {
  return transitionTaxSettlementProcessing({
    eventId,
    processingToken,
    status: "waiting_for_case",
    errorCode,
  });
}

export async function markTaxSettlementFailed(
  eventId: string,
  processingToken: string,
  errorCode: string,
) {
  return transitionTaxSettlementProcessing({
    eventId,
    processingToken,
    status: "failed",
    errorCode,
  });
}

async function transitionTaxSettlementProcessing(input: {
  eventId: string;
  processingToken: string;
  status: "waiting_for_case" | "completed" | "failed";
  errorCode: string | null;
}) {
  const now = new Date();
  const [delivery] = await db
    .update(taxSettlementDeliveries)
    .set({
      status: input.status,
      lastErrorCode: input.errorCode,
      processingToken: null,
      processingStartedAt: null,
      ...(input.status === "completed" ? { completedAt: now } : {}),
      updatedAt: now,
    })
    .where(
      and(
        eq(taxSettlementDeliveries.eventId, input.eventId),
        eq(taxSettlementDeliveries.status, "processing"),
        eq(taxSettlementDeliveries.processingToken, input.processingToken),
      ),
    )
    .returning();
  if (delivery) return delivery;
  const current = await findTaxSettlementDelivery(input.eventId);
  if (!current) throw new Error("Settlement delivery was not found");
  return current;
}

async function findTaxSettlementDelivery(eventId: string) {
  return db.query.taxSettlementDeliveries.findFirst({
    where: eq(taxSettlementDeliveries.eventId, eventId),
  });
}

export async function listPendingTaxSettlementDeliveries(
  operatingPackRunId: string,
  limit = 100,
) {
  return db
    .select()
    .from(taxSettlementDeliveries)
    .where(
      and(
        eq(taxSettlementDeliveries.operatingPackRunId, operatingPackRunId),
        retryableSettlementStatus(),
      ),
    )
    .orderBy(
      asc(
        sql<number>`case when ${taxSettlementDeliveries.eventType} = 'InvoiceSettlementFinalizedV1' then 0 else 1 end`,
      ),
      asc(taxSettlementDeliveries.createdAt),
    )
    .limit(Math.min(Math.max(limit, 1), 100));
}

export async function listDependentTaxSettlementDeliveries(input: {
  operatingPackRunId: string;
  workspaceId: string;
  ledgerInvoiceId: string;
  reversesEventId: string;
}) {
  return db
    .select()
    .from(taxSettlementDeliveries)
    .where(
      and(
        eq(
          taxSettlementDeliveries.operatingPackRunId,
          input.operatingPackRunId,
        ),
        eq(taxSettlementDeliveries.workspaceId, input.workspaceId),
        eq(taxSettlementDeliveries.ledgerInvoiceId, input.ledgerInvoiceId),
        eq(taxSettlementDeliveries.reversesEventId, input.reversesEventId),
        retryableSettlementStatus(),
      ),
    )
    .orderBy(asc(taxSettlementDeliveries.createdAt))
    .limit(100);
}

function retryableSettlementStatus() {
  return or(
    inArray(taxSettlementDeliveries.status, ["waiting_for_case", "failed"]),
    and(
      eq(taxSettlementDeliveries.status, "processing"),
      or(
        isNull(taxSettlementDeliveries.processingStartedAt),
        lt(
          taxSettlementDeliveries.processingStartedAt,
          new Date(Date.now() - TAX_SETTLEMENT_PROCESSING_LEASE_MS),
        ),
      ),
    ),
  );
}

export async function countCompletedTaxSettlementDeliveries(
  operatingPackRunId: string,
): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(taxSettlementDeliveries)
    .where(
      and(
        eq(taxSettlementDeliveries.operatingPackRunId, operatingPackRunId),
        eq(taxSettlementDeliveries.status, "completed"),
      ),
    );
  return row?.value ?? 0;
}
