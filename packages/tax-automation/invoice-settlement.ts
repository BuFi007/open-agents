import { createHash } from "node:crypto";
import { z } from "zod";

const decimalPattern = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const decimal = z
  .string()
  .max(80, "Decimal strings are limited to 80 characters")
  .regex(decimalPattern, "Use an exact non-negative decimal string");
const positiveDecimal = decimal.refine(
  (value) => isCanonicalDecimal(value) && compareDecimals(value, "0") > 0,
  "Amount must be greater than zero",
);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const currency = z.string().regex(/^[A-Z][A-Z0-9]{2,11}$/);
const timestamp = z.iso.datetime({ offset: true });

const sourceKinds = [
  "circle_transfer",
  "circle_memo",
  "bridge_liquidation",
  "external_wallet_receipt",
  "reviewed_bank_match",
  "reviewed_accounting_match",
  "approved_manual_evidence",
  "recibu_payment",
  "provider_reversal",
] as const;

const verificationMethods = [
  "provider_webhook",
  "onchain_receipt",
  "reviewed_financial_match",
  "approved_manual_review",
] as const;

const verificationMethodBySource = {
  circle_transfer: "provider_webhook",
  circle_memo: "onchain_receipt",
  bridge_liquidation: "provider_webhook",
  external_wallet_receipt: "onchain_receipt",
  reviewed_bank_match: "reviewed_financial_match",
  reviewed_accounting_match: "reviewed_financial_match",
  approved_manual_evidence: "approved_manual_review",
  recibu_payment: "onchain_receipt",
} as const satisfies Omit<
  Record<(typeof sourceKinds)[number], (typeof verificationMethods)[number]>,
  "provider_reversal"
>;

const sourceMoneySchema = z
  .object({
    currency,
    grossAmount: positiveDecimal,
    feeAmount: decimal,
    netAmount: positiveDecimal,
  })
  .strict()
  .superRefine((money, context) => {
    if (
      isCanonicalDecimal(money.grossAmount) &&
      isCanonicalDecimal(money.feeAmount) &&
      isCanonicalDecimal(money.netAmount) &&
      compareDecimals(
        money.grossAmount,
        addDecimals(money.feeAmount, money.netAmount),
      ) !== 0
    )
      context.addIssue({
        code: "custom",
        path: ["netAmount"],
        message: "grossAmount must equal feeAmount plus netAmount",
      });
  });

const fxSchema = z
  .object({
    rate: positiveDecimal,
    sourceCurrency: currency,
    allocationCurrency: currency,
    evidenceRef: z.uuid(),
    evidenceHash: sha256,
    verifiedAt: timestamp,
  })
  .strict();

const projectionSchema = z
  .object({
    version: z.number().int().positive().safe(),
    state: z.enum(["unpaid", "partially_paid", "paid"]),
    invoiceTotal: positiveDecimal,
    settledTotal: decimal,
    outstandingAmount: decimal,
  })
  .strict()
  .superRefine((projection, context) => {
    if (
      !isCanonicalDecimal(projection.invoiceTotal) ||
      !isCanonicalDecimal(projection.settledTotal) ||
      !isCanonicalDecimal(projection.outstandingAmount)
    )
      return;
    const settledVsZero = compareDecimals(projection.settledTotal, "0");
    const outstandingVsZero = compareDecimals(
      projection.outstandingAmount,
      "0",
    );
    if (
      compareDecimals(
        projection.invoiceTotal,
        addDecimals(projection.settledTotal, projection.outstandingAmount),
      ) !== 0
    )
      context.addIssue({
        code: "custom",
        path: ["outstandingAmount"],
        message: "settledTotal plus outstandingAmount must equal invoiceTotal",
      });
    if (
      (projection.state === "unpaid" && settledVsZero !== 0) ||
      (projection.state === "partially_paid" &&
        (settledVsZero <= 0 || outstandingVsZero <= 0)) ||
      (projection.state === "paid" && outstandingVsZero !== 0)
    )
      context.addIssue({
        code: "custom",
        path: ["state"],
        message: "Projection state does not match its exact balances",
      });
  });

const eventBaseSchema = z
  .object({
    schemaVersion: z.literal(1),
    eventId: z.uuid(),
    teamId: z.uuid(),
    invoiceId: z.uuid(),
    billId: z.uuid().nullable(),
    settlementId: z.uuid(),
    allocationId: z.uuid(),
    allocationRevision: z.number().int().positive().safe(),
    replayKey: sha256,
    traceId: z.union([z.uuid(), z.string().regex(/^[a-f0-9]{32}$/)]).nullable(),
    currency,
    sourceMoney: sourceMoneySchema,
    sourceEquivalentAmount: positiveDecimal,
    allocationBasis: z.enum(["gross", "net"]),
    network: z
      .string()
      .regex(/^[a-z0-9][a-z0-9._:-]{0,63}$/)
      .nullable(),
    fx: fxSchema.nullable(),
    source: z
      .object({
        kind: z.enum(sourceKinds),
        provider: z.string().regex(/^[a-z][a-z0-9._-]{1,62}[a-z0-9]$/),
        identityHash: sha256,
        revision: z.number().int().positive().safe(),
      })
      .strict(),
    evidence: z
      .object({
        status: z.literal("verified"),
        method: z.enum(verificationMethods),
        hashAlgorithm: z.literal("sha256"),
        evidenceRef: z.uuid(),
        evidenceHash: sha256,
        verifiedAt: timestamp,
      })
      .strict(),
    recordedAt: timestamp,
  })
  .strict();

const finalizedSchema = eventBaseSchema
  .extend({
    eventType: z.literal("InvoiceSettlementFinalizedV1"),
    finalizedAt: timestamp,
    allocationAmount: positiveDecimal,
    projection: projectionSchema,
  })
  .strict();

const reversedSchema = eventBaseSchema
  .extend({
    eventType: z.literal("InvoiceSettlementReversedV1"),
    reversedAt: timestamp,
    reversesEventId: z.uuid(),
    reversedAmount: positiveDecimal,
    reason: z.enum([
      "provider_reversed",
      "provider_failed",
      "chain_reorg",
      "duplicate",
      "allocation_corrected",
      "review_invalidated",
    ]),
    projection: projectionSchema,
  })
  .strict();

export const InvoiceSettlementEventV1Schema = z
  .discriminatedUnion("eventType", [finalizedSchema, reversedSchema])
  .superRefine((event, context) => {
    if (
      (event.eventType === "InvoiceSettlementFinalizedV1" &&
        event.source.kind === "provider_reversal") ||
      (event.eventType === "InvoiceSettlementReversedV1" &&
        event.source.kind !== "provider_reversal")
    )
      context.addIssue({
        code: "custom",
        path: ["source", "kind"],
        message: "Settlement source kind does not match the event type",
      });
    if (
      event.source.kind !== "provider_reversal" &&
      event.evidence.method !== verificationMethodBySource[event.source.kind]
    )
      context.addIssue({
        code: "custom",
        path: ["evidence", "method"],
        message: `Verification method does not match ${event.source.kind}`,
      });

    const allocationAmount =
      event.eventType === "InvoiceSettlementFinalizedV1"
        ? event.allocationAmount
        : event.reversedAmount;
    const sourceBasis =
      event.allocationBasis === "gross"
        ? event.sourceMoney.grossAmount
        : event.sourceMoney.netAmount;
    if (
      !isCanonicalDecimal(event.sourceEquivalentAmount) ||
      !isCanonicalDecimal(sourceBasis) ||
      !isCanonicalDecimal(allocationAmount) ||
      !isCanonicalDecimal(event.projection.settledTotal)
    )
      return;
    if (compareDecimals(event.sourceEquivalentAmount, sourceBasis) > 0)
      context.addIssue({
        code: "custom",
        path: ["sourceEquivalentAmount"],
        message:
          "Allocation cannot consume more than its selected source basis",
      });

    const crossCurrency = event.sourceMoney.currency !== event.currency;
    if (!crossCurrency) {
      if (event.fx)
        context.addIssue({
          code: "custom",
          path: ["fx"],
          message: "Same-currency allocations must not carry FX evidence",
        });
      if (compareDecimals(event.sourceEquivalentAmount, allocationAmount) !== 0)
        context.addIssue({
          code: "custom",
          path: ["sourceEquivalentAmount"],
          message:
            "Same-currency source equivalent must equal the allocation amount",
        });
    } else if (!event.fx) {
      context.addIssue({
        code: "custom",
        path: ["fx"],
        message: "Cross-currency settlement requires verified FX evidence",
      });
    } else if (
      event.fx.sourceCurrency !== event.sourceMoney.currency ||
      event.fx.allocationCurrency !== event.currency
    ) {
      context.addIssue({
        code: "custom",
        path: ["fx"],
        message: "FX evidence currencies do not match the settlement",
      });
    }

    if (event.eventType === "InvoiceSettlementFinalizedV1") {
      if (event.projection.state === "unpaid")
        context.addIssue({
          code: "custom",
          path: ["projection", "state"],
          message: "A finalized allocation cannot project an unpaid invoice",
        });
      if (
        compareDecimals(event.allocationAmount, event.projection.settledTotal) >
        0
      )
        context.addIssue({
          code: "custom",
          path: ["allocationAmount"],
          message: "Allocation cannot exceed the projected settled total",
        });
    } else if (event.reversesEventId === event.eventId) {
      context.addIssue({
        code: "custom",
        path: ["reversesEventId"],
        message: "A reversal cannot reverse itself",
      });
    }
  });

export type InvoiceSettlementEventV1 = z.infer<
  typeof InvoiceSettlementEventV1Schema
>;

export type TaxSettlementCommand = Readonly<{
  settlementReferenceHash: string;
  asset: string;
  network: string;
  amount: Readonly<{ decimal: string; currency: string }>;
  observedAt: string;
  finalityState: "final" | "reversed";
  fees: Readonly<{ decimal: string; currency: string }> | null;
  reversesSettlementReferenceHash: string | null;
  evidence: Readonly<{
    version: "factura-e-settlement-evidence-v1";
    source: Readonly<{
      kind: (typeof sourceKinds)[number];
      provider: string;
      identityHash: string;
      revision: number;
    }>;
    sourceMoney: Readonly<{
      currency: string;
      grossAmount: string;
      feeAmount: string;
      netAmount: string;
    }>;
    sourceEquivalentAmount: string;
    allocationBasis: "gross" | "net";
    fx: Readonly<{
      rate: string;
      sourceCurrency: string;
      allocationCurrency: string;
      evidenceHash: string;
      verifiedAt: string;
    }> | null;
    verification: Readonly<{
      method: (typeof verificationMethods)[number];
      evidenceHash: string;
      verifiedAt: string;
    }>;
  }>;
}>;

export function settlementReferenceHashForEvent(eventId: string): string {
  return createHash("sha256")
    .update(`invoice-settlement-v1:${eventId}`)
    .digest("hex");
}

/**
 * Lossless evidence stays in the Open Agents delivery ledger. This projection
 * maps only the Tax Engine's narrower settlement command; a provider fee is
 * forwarded only when one invoice consumes the complete same-currency source
 * basis, avoiding duplicated fees when one receipt is split across invoices.
 */
export function taxSettlementCommandFor(
  input: InvoiceSettlementEventV1,
): TaxSettlementCommand {
  const event = InvoiceSettlementEventV1Schema.parse(input);
  const reversed = event.eventType === "InvoiceSettlementReversedV1";
  const amount = reversed ? event.reversedAmount : event.allocationAmount;
  const selectedBasis =
    event.allocationBasis === "gross"
      ? event.sourceMoney.grossAmount
      : event.sourceMoney.netAmount;
  const completeSource =
    compareDecimals(event.sourceEquivalentAmount, selectedBasis) === 0;
  const sameCurrency = event.sourceMoney.currency === event.currency;

  return {
    settlementReferenceHash: settlementReferenceHashForEvent(event.eventId),
    asset: event.sourceMoney.currency,
    network:
      event.network ??
      fallbackNetwork(event.source.kind, event.source.provider),
    amount: { decimal: amount, currency: event.currency },
    observedAt: reversed ? event.reversedAt : event.finalizedAt,
    finalityState: reversed ? "reversed" : "final",
    fees:
      !reversed && sameCurrency && completeSource
        ? {
            decimal: event.sourceMoney.feeAmount,
            currency: event.currency,
          }
        : null,
    reversesSettlementReferenceHash: reversed
      ? settlementReferenceHashForEvent(event.reversesEventId)
      : null,
    evidence: {
      version: "factura-e-settlement-evidence-v1",
      source: {
        kind: event.source.kind,
        provider: event.source.provider,
        identityHash: event.source.identityHash,
        revision: event.source.revision,
      },
      sourceMoney: event.sourceMoney,
      sourceEquivalentAmount: event.sourceEquivalentAmount,
      allocationBasis: event.allocationBasis,
      fx: event.fx
        ? {
            rate: event.fx.rate,
            sourceCurrency: event.fx.sourceCurrency,
            allocationCurrency: event.fx.allocationCurrency,
            evidenceHash: event.fx.evidenceHash,
            verifiedAt: event.fx.verifiedAt,
          }
        : null,
      verification: {
        method: event.evidence.method,
        evidenceHash: event.evidence.evidenceHash,
        verifiedAt: event.evidence.verifiedAt,
      },
    },
  };
}

function fallbackNetwork(
  sourceKind: (typeof sourceKinds)[number],
  provider: string,
): string {
  if (sourceKind === "reviewed_bank_match") return "bank";
  if (sourceKind === "reviewed_accounting_match") return "accounting";
  if (sourceKind === "approved_manual_evidence") return "manual-review";
  return provider;
}

interface DecimalParts {
  coefficient: bigint;
  scale: number;
}

function isCanonicalDecimal(value: string): boolean {
  return value.length <= 80 && decimalPattern.test(value);
}

function decimalParts(value: string): DecimalParts {
  const [whole = "0", fraction = ""] = value.split(".");
  return {
    coefficient: BigInt(`${whole}${fraction}`),
    scale: fraction.length,
  };
}

function alignDecimals(left: string, right: string): [bigint, bigint, number] {
  const leftParts = decimalParts(left);
  const rightParts = decimalParts(right);
  const scale = Math.max(leftParts.scale, rightParts.scale);
  return [
    BigInt(`${leftParts.coefficient}${"0".repeat(scale - leftParts.scale)}`),
    BigInt(`${rightParts.coefficient}${"0".repeat(scale - rightParts.scale)}`),
    scale,
  ];
}

function compareDecimals(left: string, right: string): number {
  const [leftCoefficient, rightCoefficient] = alignDecimals(left, right);
  if (leftCoefficient < rightCoefficient) return -1;
  if (leftCoefficient > rightCoefficient) return 1;
  return 0;
}

function addDecimals(left: string, right: string): string {
  const [leftCoefficient, rightCoefficient, scale] = alignDecimals(left, right);
  const coefficient = (leftCoefficient + rightCoefficient).toString();
  if (scale === 0) return coefficient;

  const padded = coefficient.padStart(scale + 1, "0");
  const whole = padded.slice(0, -scale);
  const fraction = padded.slice(-scale).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}
