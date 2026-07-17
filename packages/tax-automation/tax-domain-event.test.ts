import { describe, expect, test } from "bun:test";

import {
  TaxDomainEventDeliveryV1Schema,
  TaxDomainEventV1Schema,
  taxDomainEventRequestHash,
} from "./tax-domain-event";

const HASH = "a".repeat(64);
const now = "2026-07-17T00:00:00.000Z";

function event() {
  return {
    version: "tax-domain-event-v1",
    eventId: "00000000-0000-4000-8000-000000000001",
    workspaceId: "workspace_opaque_1",
    caseRef: "taxcase_opaque_1",
    kind: "arca.api_verification_completed",
    state: "verified",
    occurredAt: now,
    idempotencyKey: "arca-api-verification_1",
    correlationRef: "correlation_1",
    source: { system: "arca", sourceEventHash: HASH, verifiedAt: now },
    authentication: {
      method: "authority_receipt",
      principalRef: "principal_authority_boundary",
      credentialVersion: "authority-v1",
      signatureHash: HASH,
    },
    consent: {
      purpose: "tax_workspace_processing",
      version: "consent-v1",
      scopeHash: HASH,
      state: "active",
    },
    evidenceHashes: [HASH],
    ruleVersionIds: ["rule_1"],
    policyVersionIds: ["policy_1"],
    actionRefs: ["action_review_arca"],
  };
}

describe("Open Agents TaxDomainEventV1 consumer boundary", () => {
  test("accepts the safe event and hashes canonical key order consistently", () => {
    const parsed = TaxDomainEventV1Schema.parse(event());
    expect(taxDomainEventRequestHash(parsed)).toMatch(/^[a-f0-9]{64}$/);
    expect(taxDomainEventRequestHash(parsed)).toBe(
      taxDomainEventRequestHash({ ...parsed, evidenceHashes: [...parsed.evidenceHashes] }),
    );
  });

  test("fails closed on raw fiscal data, money, credentials, and extra fields", () => {
    expect(TaxDomainEventV1Schema.safeParse({ ...event(), cuit: "20123456789" }).success).toBe(false);
    expect(TaxDomainEventV1Schema.safeParse({ ...event(), amount: { decimal: "1", currency: "USD" } }).success).toBe(false);
    expect(TaxDomainEventV1Schema.safeParse({ ...event(), source: { ...event().source, rawAuthorityResponse: "forbidden" } }).success).toBe(false);
    expect(TaxDomainEventV1Schema.safeParse({ ...event(), authentication: { ...event().authentication, credential: "forbidden" } }).success).toBe(false);
  });

  test("accepts only a delivery envelope bound to the canonical payload hash", () => {
    const safeEvent = TaxDomainEventV1Schema.parse(event());
    const payloadHash = taxDomainEventRequestHash(safeEvent);
    expect(
      TaxDomainEventDeliveryV1Schema.parse({
        version: "tax-domain-event-delivery-v1",
        deliveryId: "20000000-0000-4000-8000-000000000001",
        event: safeEvent,
        payloadHash,
        deliveredAt: now,
      }),
    ).toMatchObject({ payloadHash });
    expect(() =>
      TaxDomainEventDeliveryV1Schema.parse({
        version: "tax-domain-event-delivery-v1",
        deliveryId: "20000000-0000-4000-8000-000000000001",
        event: safeEvent,
        payloadHash: "b".repeat(64),
        deliveredAt: now,
      }),
    ).toThrow("TAX_DOMAIN_EVENT_PAYLOAD_HASH_INVALID");
  });
});
