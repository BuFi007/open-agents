import { createHash } from "node:crypto";
import { z } from "zod";

/**
 * Consumer-side validation for Tax Engine's published TaxDomainEventV1 wire
 * contract. This is a defensive parser, not an alternate source of tax truth.
 */
export const TAX_DOMAIN_EVENT_VERSION_V1 = "tax-domain-event-v1" as const;
export const TAX_DOMAIN_EVENT_KINDS_V1 = [
  "arca.api_verification_completed",
  "reclaim.proof_verified",
  "factura_e.authority_verified",
  "invoice.settlement_finalized",
  "evidence.gap_changed",
  "obligation.due",
  "consent.revoked",
  "accountant.decision_recorded",
  "factura_e_feature_published",
] as const;

const opaqueRef = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9:_-]*$/)
  .refine((value) => !/^\d{9,}$/.test(value), {
    message: "Opaque references cannot be raw identifiers",
  });
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const instant = z.iso.datetime({ offset: true });

export const TaxDomainEventV1Schema = z
  .object({
    version: z.literal(TAX_DOMAIN_EVENT_VERSION_V1),
    eventId: z.uuid(),
    workspaceId: opaqueRef,
    caseRef: opaqueRef.nullable(),
    kind: z.enum(TAX_DOMAIN_EVENT_KINDS_V1),
    state: z.enum([
      "pending",
      "ready",
      "verified",
      "recorded",
      "blocked",
      "ambiguous",
      "rejected",
      "revoked",
      "stale",
    ]),
    occurredAt: instant,
    idempotencyKey: opaqueRef,
    correlationRef: opaqueRef,
    source: z
      .object({
        system: z.enum([
          "arca",
          "reclaim",
          "invoice_ledger",
          "tax_engine",
          "evidence_graph",
          "accountant_workspace",
          "factoring",
        ]),
        sourceEventHash: hash,
        verifiedAt: instant,
      })
      .strict(),
    authentication: z
      .object({
        method: z.enum([
          "provider_webhook",
          "authority_receipt",
          "m2m_signed_grant",
          "internal_outbox",
        ]),
        principalRef: opaqueRef,
        credentialVersion: z.string().min(1).max(120),
        signatureHash: hash,
      })
      .strict(),
    consent: z
      .object({
        purpose: z.enum([
          "tax_workspace_processing",
          "provider_submission",
          "factura_e_factoring",
        ]),
        version: z.string().min(1).max(120),
        scopeHash: hash,
        state: z.enum(["active", "revoked"]),
      })
      .strict(),
    evidenceHashes: z.array(hash).max(16),
    ruleVersionIds: z.array(opaqueRef).max(16),
    policyVersionIds: z.array(opaqueRef).max(16),
    actionRefs: z.array(opaqueRef).max(16),
  })
  .strict();

export type TaxDomainEventV1 = z.infer<typeof TaxDomainEventV1Schema>;

export const TAX_DOMAIN_EVENT_DELIVERY_VERSION_V1 =
  "tax-domain-event-delivery-v1" as const;

/**
 * Transport envelope published by the Tax Engine outbox. The payload hash is
 * verified before an event can enter the durable Open Agents inbox.
 */
export const TaxDomainEventDeliveryV1Schema = z
  .object({
    version: z.literal(TAX_DOMAIN_EVENT_DELIVERY_VERSION_V1),
    deliveryId: z.uuid(),
    event: TaxDomainEventV1Schema,
    payloadHash: hash,
    deliveredAt: instant,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.payloadHash !== taxDomainEventRequestHash(value.event)) {
      context.addIssue({
        code: "custom",
        message: "TAX_DOMAIN_EVENT_PAYLOAD_HASH_INVALID",
        path: ["payloadHash"],
      });
    }
  });

export type TaxDomainEventDeliveryV1 = z.infer<
  typeof TaxDomainEventDeliveryV1Schema
>;

export function taxDomainEventRequestHash(event: TaxDomainEventV1): string {
  return createHash("sha256").update(canonicalJson(event)).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
