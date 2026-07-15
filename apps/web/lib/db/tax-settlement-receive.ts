import type { InvoiceSettlementEventV1 } from "@open-agents/tax-automation";
import type { TaxInvoiceBinding, TaxSettlementDelivery } from "./schema";

type BindingIdentity = Pick<
  TaxInvoiceBinding,
  "operatingPackRunId" | "taxRunId"
>;

type DeliveryInsert = Pick<
  TaxSettlementDelivery,
  | "eventId"
  | "workspaceId"
  | "ledgerInvoiceId"
  | "operatingPackRunId"
  | "taxRunId"
  | "eventType"
  | "reversesEventId"
  | "replayKey"
  | "requestHash"
  | "payload"
  | "status"
>;

export interface TaxSettlementReceiveStore {
  findBinding(
    workspaceId: string,
    ledgerInvoiceId: string,
  ): Promise<TaxInvoiceBinding | undefined>;
  insertDelivery(
    delivery: DeliveryInsert,
  ): Promise<TaxSettlementDelivery | undefined>;
  findDelivery(eventId: string): Promise<TaxSettlementDelivery | undefined>;
  backfillBinding(input: {
    eventId: string;
    workspaceId: string;
    ledgerInvoiceId: string;
    binding: BindingIdentity;
  }): Promise<TaxSettlementDelivery | undefined>;
}

export class TaxSettlementDeliveryConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaxSettlementDeliveryConflictError";
  }
}

/**
 * Persists a settlement before resolving its final case binding. Reading the
 * binding both before and after the insert closes both possible interleavings
 * with bindTaxInvoiceRun: either side will observe and backfill the other row.
 */
export async function receiveTaxSettlementDeliveryWithStore(
  input: { event: InvoiceSettlementEventV1; requestHash: string },
  store: TaxSettlementReceiveStore,
) {
  const initialBinding = await store.findBinding(
    input.event.teamId,
    input.event.invoiceId,
  );
  const created = await store.insertDelivery({
    eventId: input.event.eventId,
    workspaceId: input.event.teamId,
    ledgerInvoiceId: input.event.invoiceId,
    operatingPackRunId: initialBinding?.operatingPackRunId ?? null,
    taxRunId: initialBinding?.taxRunId ?? null,
    eventType: input.event.eventType,
    reversesEventId:
      input.event.eventType === "InvoiceSettlementReversedV1"
        ? input.event.reversesEventId
        : null,
    replayKey: input.event.replayKey,
    requestHash: input.requestHash,
    payload: input.event,
    status: "waiting_for_case",
  });
  const delivery = created ?? (await store.findDelivery(input.event.eventId));
  if (!delivery)
    throw new TaxSettlementDeliveryConflictError(
      "Settlement delivery identity conflicts with another replay",
    );
  if (
    delivery.workspaceId !== input.event.teamId ||
    delivery.ledgerInvoiceId !== input.event.invoiceId ||
    delivery.replayKey !== input.event.replayKey ||
    delivery.requestHash !== input.requestHash
  )
    throw new TaxSettlementDeliveryConflictError(
      "Settlement delivery idempotency conflict",
    );

  const binding = await store.findBinding(
    input.event.teamId,
    input.event.invoiceId,
  );
  if (!binding) return { delivery, binding, created: Boolean(created) };

  if (
    (delivery.operatingPackRunId !== null &&
      delivery.operatingPackRunId !== binding.operatingPackRunId) ||
    (delivery.taxRunId !== null && delivery.taxRunId !== binding.taxRunId)
  )
    throw new TaxSettlementDeliveryConflictError(
      "Settlement delivery is bound to another tax case",
    );

  if (
    delivery.operatingPackRunId === binding.operatingPackRunId &&
    delivery.taxRunId === binding.taxRunId
  )
    return { delivery, binding, created: Boolean(created) };

  const backfilled = await store.backfillBinding({
    eventId: input.event.eventId,
    workspaceId: input.event.teamId,
    ledgerInvoiceId: input.event.invoiceId,
    binding,
  });
  if (!backfilled)
    throw new Error("Settlement delivery disappeared during case binding");
  return { delivery: backfilled, binding, created: Boolean(created) };
}
