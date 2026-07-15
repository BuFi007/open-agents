import { describe, expect, test } from "bun:test";
import {
  concurrentTaxSettlementOutcome,
  drainPendingTaxSettlementDeliveries,
  prioritizeTaxSettlementDeliveries,
} from "./tax-settlement-processing";

const finalized = {
  eventId: "finalized",
  eventType: "InvoiceSettlementFinalizedV1" as const,
  createdAt: new Date("2026-07-15T14:00:01.000Z"),
};

const reversed = {
  eventId: "reversed",
  eventType: "InvoiceSettlementReversedV1" as const,
  createdAt: new Date("2026-07-15T14:00:00.000Z"),
};

describe("tax settlement causal processing", () => {
  test("prioritizes finalized facts ahead of earlier reversal deliveries", () => {
    expect(
      prioritizeTaxSettlementDeliveries([reversed, finalized]).map(
        (delivery) => delivery.eventId,
      ),
    ).toEqual(["finalized", "reversed"]);
  });

  test("keeps draining when a finalized fact unlocks a causal reversal", async () => {
    let pending: Array<typeof finalized | typeof reversed> = [finalized];
    const order: string[] = [];
    const completed = await drainPendingTaxSettlementDeliveries({
      listPending: async () => pending,
      deliver: async (delivery) => {
        order.push(delivery.eventId);
        pending = delivery.eventId === "finalized" ? [reversed] : [];
        return { status: "completed" };
      },
    });

    expect(order).toEqual(["finalized", "reversed"]);
    expect(completed).toBe(2);
  });

  test("never lets stale completion or failure regress the current owner", () => {
    expect(concurrentTaxSettlementOutcome("completed", "failed")).toEqual({
      status: "completed",
      replayed: true,
      taxRevision: null,
    });
    expect(concurrentTaxSettlementOutcome("processing", "completed")).toEqual({
      status: "processing",
    });
    expect(concurrentTaxSettlementOutcome("failed", "failed")).toBeNull();
    expect(() =>
      concurrentTaxSettlementOutcome("waiting_for_case", "failed"),
    ).toThrow("lost ownership");
  });
});
