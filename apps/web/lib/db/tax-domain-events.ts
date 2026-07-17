import { randomUUID } from "node:crypto";
import type { TaxDomainEventV1 } from "@open-agents/tax-automation";
import { and, eq, isNull, lt, ne, or } from "drizzle-orm";

import { db } from "./client";
import {
  taxCaseBindings,
  taxDomainEventDeliveries,
  taxDomainEventTargets,
} from "./schema";

export class TaxDomainEventDeliveryConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaxDomainEventDeliveryConflictError";
  }
}

type TaxCaseBindingInput = Readonly<{
  workspaceId: string;
  taxRunId: string;
  operatingPackRunId: string;
  caseKind: "invoice" | "workspace" | "agency" | "accountant";
}>;

/**
 * Register an existing canonical TaxCase and attach events that arrived before
 * the case existed. The registry is routing state only; Tax Engine remains the
 * owner of evidence and fiscal state.
 */
export async function bindTaxCaseRun(input: TaxCaseBindingInput) {
  return db.transaction(async (transaction) => {
    await transaction
      .insert(taxCaseBindings)
      .values(input)
      .onConflictDoNothing({
        target: [taxCaseBindings.workspaceId, taxCaseBindings.taxRunId],
      });
    const binding = await transaction.query.taxCaseBindings.findFirst({
      where: and(
        eq(taxCaseBindings.workspaceId, input.workspaceId),
        eq(taxCaseBindings.taxRunId, input.taxRunId),
      ),
    });
    if (!binding) throw new Error("TaxCase binding was not persisted");
    if (
      binding.operatingPackRunId !== input.operatingPackRunId ||
      binding.caseKind !== input.caseKind ||
      binding.status !== "active"
    )
      throw new TaxDomainEventDeliveryConflictError(
        "TaxCase is already bound to another workflow",
      );

    const waiting = await transaction.query.taxDomainEventDeliveries.findMany({
      where: and(
        eq(taxDomainEventDeliveries.workspaceId, input.workspaceId),
        eq(taxDomainEventDeliveries.status, "waiting_for_case"),
        or(
          isNull(taxDomainEventDeliveries.caseRef),
          eq(taxDomainEventDeliveries.caseRef, input.taxRunId),
        ),
      ),
    });
    if (waiting.length > 0) {
      await transaction
        .insert(taxDomainEventTargets)
        .values(
          waiting.map((delivery) => ({
            eventId: delivery.eventId,
            workspaceId: input.workspaceId,
            operatingPackRunId: input.operatingPackRunId,
            taxRunId: input.taxRunId,
          })),
        )
        .onConflictDoNothing();
      for (const delivery of waiting) {
        await transaction
          .update(taxDomainEventDeliveries)
          .set({ status: "received", updatedAt: new Date() })
          .where(eq(taxDomainEventDeliveries.eventId, delivery.eventId));
      }
    }
    return binding;
  });
}

/**
 * Persist incoming external truth and its complete fan-out before waking a
 * workflow. A case-scoped event resolves one exact tenant binding; a null
 * caseRef snapshots every active case in the workspace.
 */
export async function receiveTaxDomainEventDelivery(input: {
  event: TaxDomainEventV1;
  requestHash: string;
}) {
  return db.transaction(async (transaction) => {
    const bindings = input.event.caseRef
      ? await transaction.query.taxCaseBindings.findMany({
          where: and(
            eq(taxCaseBindings.workspaceId, input.event.workspaceId),
            eq(taxCaseBindings.taxRunId, input.event.caseRef),
            eq(taxCaseBindings.status, "active"),
          ),
        })
      : await transaction.query.taxCaseBindings.findMany({
          where: and(
            eq(taxCaseBindings.workspaceId, input.event.workspaceId),
            eq(taxCaseBindings.status, "active"),
          ),
        });

    const [created] = await transaction
      .insert(taxDomainEventDeliveries)
      .values({
        eventId: input.event.eventId,
        workspaceId: input.event.workspaceId,
        caseRef: input.event.caseRef,
        operatingPackRunId:
          bindings.length === 1 ? bindings[0]?.operatingPackRunId : null,
        taxRunId: bindings.length === 1 ? bindings[0]?.taxRunId : null,
        kind: input.event.kind,
        idempotencyKey: input.event.idempotencyKey,
        requestHash: input.requestHash,
        payload: input.event,
        status: bindings.length > 0 ? "received" : "waiting_for_case",
      })
      .onConflictDoNothing()
      .returning();
    let delivery =
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

    if (
      delivery.status !== "woken" &&
      bindings.length > 0 &&
      (Boolean(created) || delivery.status === "waiting_for_case")
    ) {
      await transaction
        .insert(taxDomainEventTargets)
        .values(
          bindings.map((binding) => ({
            eventId: input.event.eventId,
            workspaceId: input.event.workspaceId,
            operatingPackRunId: binding.operatingPackRunId,
            taxRunId: binding.taxRunId,
          })),
        )
        .onConflictDoNothing();
      if (delivery.status === "waiting_for_case") {
        [delivery] = await transaction
          .update(taxDomainEventDeliveries)
          .set({ status: "received", updatedAt: new Date() })
          .where(eq(taxDomainEventDeliveries.eventId, input.event.eventId))
          .returning();
      }
    }
    const targets = await transaction.query.taxDomainEventTargets.findMany({
      where: eq(taxDomainEventTargets.eventId, input.event.eventId),
    });
    return { delivery, targets, created: Boolean(created) };
  });
}

/** Claim unfinished wake targets with fencing. A concurrent replay cannot
 * resume a target already leased by another request. */
export async function claimTaxDomainEventTargets(input: {
  eventId: string;
  now: Date;
  leaseUntil: Date;
}) {
  return db.transaction(async (transaction) => {
    const candidates = await transaction.query.taxDomainEventTargets.findMany({
      where: and(
        eq(taxDomainEventTargets.eventId, input.eventId),
        or(
          eq(taxDomainEventTargets.status, "pending"),
          and(
            eq(taxDomainEventTargets.status, "waking"),
            lt(taxDomainEventTargets.leaseUntil, input.now),
          ),
        ),
      ),
    });
    const claimed = [];
    for (const candidate of candidates) {
      const leaseToken = randomUUID();
      const [target] = await transaction
        .update(taxDomainEventTargets)
        .set({
          status: "waking",
          leaseToken,
          leaseUntil: input.leaseUntil,
          attempts: candidate.attempts + 1,
          lastErrorCode: null,
          updatedAt: input.now,
        })
        .where(
          and(
            eq(taxDomainEventTargets.eventId, candidate.eventId),
            eq(
              taxDomainEventTargets.operatingPackRunId,
              candidate.operatingPackRunId,
            ),
            or(
              eq(taxDomainEventTargets.status, "pending"),
              and(
                eq(taxDomainEventTargets.status, "waking"),
                lt(taxDomainEventTargets.leaseUntil, input.now),
              ),
            ),
          ),
        )
        .returning();
      if (target) claimed.push(target);
    }
    return claimed;
  });
}

export async function completeTaxDomainEventTarget(input: {
  eventId: string;
  operatingPackRunId: string;
  leaseToken: string;
}) {
  return db.transaction(async (transaction) => {
    const [target] = await transaction
      .update(taxDomainEventTargets)
      .set({
        status: "woken",
        leaseToken: null,
        leaseUntil: null,
        wokenAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(taxDomainEventTargets.eventId, input.eventId),
          eq(
            taxDomainEventTargets.operatingPackRunId,
            input.operatingPackRunId,
          ),
          eq(taxDomainEventTargets.status, "waking"),
          eq(taxDomainEventTargets.leaseToken, input.leaseToken),
        ),
      )
      .returning();
    if (!target) throw new Error("TAX_DOMAIN_EVENT_TARGET_LEASE_LOST");
    const unfinished = await transaction.query.taxDomainEventTargets.findFirst({
      where: and(
        eq(taxDomainEventTargets.eventId, input.eventId),
        ne(taxDomainEventTargets.status, "woken"),
      ),
    });
    if (!unfinished)
      await transaction
        .update(taxDomainEventDeliveries)
        .set({ status: "woken", wokenAt: new Date(), updatedAt: new Date() })
        .where(eq(taxDomainEventDeliveries.eventId, input.eventId));
    return { target, complete: !unfinished };
  });
}

export async function releaseTaxDomainEventTarget(input: {
  eventId: string;
  operatingPackRunId: string;
  leaseToken: string;
  errorCode: string;
}) {
  await db
    .update(taxDomainEventTargets)
    .set({
      status: "pending",
      leaseToken: null,
      leaseUntil: null,
      lastErrorCode: input.errorCode,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(taxDomainEventTargets.eventId, input.eventId),
        eq(taxDomainEventTargets.operatingPackRunId, input.operatingPackRunId),
        eq(taxDomainEventTargets.status, "waking"),
        eq(taxDomainEventTargets.leaseToken, input.leaseToken),
      ),
    );
}

export async function getTaxDomainEventProgress(eventId: string) {
  const [delivery, targets] = await Promise.all([
    db.query.taxDomainEventDeliveries.findFirst({
      where: eq(taxDomainEventDeliveries.eventId, eventId),
    }),
    db.query.taxDomainEventTargets.findMany({
      where: eq(taxDomainEventTargets.eventId, eventId),
    }),
  ]);
  return { delivery, targets };
}
