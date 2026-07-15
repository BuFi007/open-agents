export type PendingTaxSettlementDelivery = Readonly<{
  eventId: string;
  eventType: "InvoiceSettlementFinalizedV1" | "InvoiceSettlementReversedV1";
  createdAt: Date;
}>;

export type PendingTaxSettlementResult = Readonly<{
  status: "completed" | "processing" | "waiting_for_case";
}>;

type StoredTaxSettlementStatus =
  | "waiting_for_case"
  | "processing"
  | "completed"
  | "failed";

export type ConcurrentTaxSettlementOutcome =
  | Readonly<{ status: "completed"; replayed: true; taxRevision: null }>
  | Readonly<{ status: "processing" }>;

export function concurrentTaxSettlementOutcome(
  currentStatus: StoredTaxSettlementStatus,
  intendedStatus: Exclude<StoredTaxSettlementStatus, "processing">,
): ConcurrentTaxSettlementOutcome | null {
  if (currentStatus === intendedStatus) return null;
  if (currentStatus === "completed")
    return { status: "completed", replayed: true, taxRevision: null };
  if (currentStatus === "processing") return { status: "processing" };
  throw new Error("Tax settlement processing transition lost ownership");
}

export function prioritizeTaxSettlementDeliveries<
  T extends PendingTaxSettlementDelivery,
>(deliveries: readonly T[]): T[] {
  return [...deliveries].sort((left, right) => {
    const leftPriority =
      left.eventType === "InvoiceSettlementFinalizedV1" ? 0 : 1;
    const rightPriority =
      right.eventType === "InvoiceSettlementFinalizedV1" ? 0 : 1;
    return (
      leftPriority - rightPriority ||
      left.createdAt.getTime() - right.createdAt.getTime() ||
      left.eventId.localeCompare(right.eventId)
    );
  });
}

/**
 * Drains bounded batches until a pass makes no progress. This immediately
 * revisits causal reversals after their finalized event succeeds and also
 * advances beyond a full first batch without spinning on unresolved facts.
 */
export async function drainPendingTaxSettlementDeliveries<
  T extends PendingTaxSettlementDelivery,
>(input: {
  listPending: () => Promise<readonly T[]>;
  deliver: (delivery: T) => Promise<PendingTaxSettlementResult>;
  maxPasses?: number;
}): Promise<number> {
  const maxPasses = Math.min(Math.max(input.maxPasses ?? 100, 1), 100);
  let completed = 0;
  for (let pass = 0; pass < maxPasses; pass += 1) {
    const pending = prioritizeTaxSettlementDeliveries(
      await input.listPending(),
    );
    if (pending.length === 0) break;
    let passProgress = 0;
    for (const delivery of pending) {
      const result = await input.deliver(delivery);
      if (result.status === "completed") passProgress += 1;
    }
    completed += passProgress;
    if (passProgress === 0) break;
  }
  return completed;
}
