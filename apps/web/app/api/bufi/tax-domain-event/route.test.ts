import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  TaxDomainEventV1Schema,
  taxDomainEventRequestHash,
} from "@open-agents/tax-automation";
import type { NextRequest } from "next/server";

const ingressSecret = "ingress-secret-that-is-at-least-thirty-two-bytes";
const signingSecret = "event-signing-secret-that-is-at-least-thirty-two-bytes";
const HASH = "a".repeat(64);
const now = "2026-07-17T00:00:00.000Z";

let deliveryStatus: "waiting_for_case" | "received" | "woken" =
  "waiting_for_case";
let targets: Array<{
  operatingPackRunId: string;
  taxRunId: string;
  leaseToken: string;
}> = [];
let completedTargets = new Set<string>();
let created = true;
let receiveError: Error | null = null;
let resumeError: Error | null = null;
let markError: Error | null = null;
let calls: string[] = [];

class MockConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MockConflictError";
  }
}

mock.module("@/lib/db/tax-domain-events", () => ({
  TaxDomainEventDeliveryConflictError: MockConflictError,
  receiveTaxDomainEventDelivery: async () => {
    calls.push("persist");
    if (receiveError) throw receiveError;
    return {
      targets,
      created,
      delivery: { status: deliveryStatus },
    };
  },
  claimTaxDomainEventTargets: async () => {
    calls.push("claim");
    return deliveryStatus === "received" ? targets : [];
  },
  completeTaxDomainEventTarget: async (input: {
    operatingPackRunId: string;
  }) => {
    calls.push("mark-woken");
    if (markError) throw markError;
    completedTargets.add(input.operatingPackRunId);
    if (completedTargets.size === targets.length) deliveryStatus = "woken";
    return { complete: deliveryStatus === "woken" };
  },
  releaseTaxDomainEventTarget: async () => {
    calls.push("release");
  },
  getTaxDomainEventProgress: async () => {
    calls.push("progress");
    return { delivery: { status: deliveryStatus }, targets };
  },
}));

mock.module("@/lib/operating-packs/tax-settlement-hook", () => ({
  getTaxWorkflowWakeHookToken: () => "tax_workflow_hook",
}));

mock.module("workflow/api", () => ({
  resumeHook: async () => {
    calls.push("resume");
    if (resumeError) throw resumeError;
  },
}));

const { POST } = await import("./route");

function event() {
  return TaxDomainEventV1Schema.parse({
    version: "tax-domain-event-v1",
    eventId: "10000000-0000-4000-8000-000000000001",
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
  });
}

function envelope(overrides: Record<string, unknown> = {}) {
  const safeEvent = event();
  return {
    version: "tax-domain-event-delivery-v1",
    deliveryId: "20000000-0000-4000-8000-000000000001",
    event: safeEvent,
    payloadHash: taxDomainEventRequestHash(safeEvent),
    deliveredAt: now,
    ...overrides,
  };
}

function request(
  body: unknown,
  options: { authorized?: boolean; signed?: boolean } = {},
): NextRequest {
  const rawBody = JSON.stringify(body);
  const signature = createHmac("sha256", signingSecret)
    .update(rawBody)
    .digest("hex");
  return new Request("https://open-agents.test/api/bufi/tax-domain-event", {
    method: "POST",
    headers: {
      authorization:
        options.authorized === false
          ? "Bearer invalid"
          : `Bearer ${ingressSecret}`,
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(rawBody)),
      "x-bufi-tax-event-signature":
        options.signed === false ? "0".repeat(64) : signature,
    },
    body: rawBody,
  }) as NextRequest;
}

beforeEach(() => {
  process.env.OPEN_AGENTS_BUFI_INGRESS_SECRET = ingressSecret;
  process.env.OPEN_AGENTS_TAX_DOMAIN_EVENT_HMAC_SECRET = signingSecret;
  deliveryStatus = "waiting_for_case";
  targets = [];
  completedTargets = new Set();
  created = true;
  receiveError = null;
  resumeError = null;
  markError = null;
  calls = [];
});

describe("TaxDomainEventV1 durable ingress", () => {
  test("rejects an invalid bearer or body signature before persistence", async () => {
    expect(
      (await POST(request(envelope(), { authorized: false }))).status,
    ).toBe(401);
    expect((await POST(request(envelope(), { signed: false }))).status).toBe(
      401,
    );
    expect(calls).toEqual([]);
  });

  test("rejects a mismatched hash and privacy-unsafe event", async () => {
    expect(
      (await POST(request(envelope({ payloadHash: "b".repeat(64) })))).status,
    ).toBe(400);
    const unsafe = { ...event(), cuit: "9".repeat(11) };
    expect(
      (
        await POST(
          request(
            envelope({
              event: unsafe,
              payloadHash: taxDomainEventRequestHash(unsafe as never),
            }),
          ),
        )
      ).status,
    ).toBe(400);
    expect(calls).toEqual([]);
  });

  test("persists an early event and refuses to acknowledge the producer", async () => {
    const response = await POST(request(envelope()));
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      version: "tax-domain-event-receipt-v1",
      accepted: false,
      status: "waiting_for_tax_case",
    });
    expect(calls).toEqual(["persist"]);
  });

  test("persists before waking a bound Tax workflow and binds the receipt", async () => {
    targets = [
      {
        operatingPackRunId: "tax_execution_1",
        taxRunId: "taxcase_opaque_1",
        leaseToken: "lease_1",
      },
    ];
    deliveryStatus = "received";
    const response = await POST(request(envelope()));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      deliveryId: "20000000-0000-4000-8000-000000000001",
      eventId: event().eventId,
      payloadHash: taxDomainEventRequestHash(event()),
      accepted: true,
      status: "woken",
    });
    expect(calls).toEqual([
      "persist",
      "claim",
      "resume",
      "mark-woken",
      "progress",
    ]);
  });

  test("retains the durable inbox row when workflow wake-up fails", async () => {
    targets = [
      {
        operatingPackRunId: "tax_execution_1",
        taxRunId: "taxcase_opaque_1",
        leaseToken: "lease_1",
      },
    ];
    deliveryStatus = "received";
    resumeError = new Error("workflow unavailable");
    expect((await POST(request(envelope()))).status).toBe(503);
    expect(calls).toEqual([
      "persist",
      "claim",
      "resume",
      "release",
      "progress",
    ]);
  });

  test("acknowledges a woken replay without waking twice", async () => {
    targets = [
      {
        operatingPackRunId: "tax_execution_1",
        taxRunId: "taxcase_opaque_1",
        leaseToken: "lease_1",
      },
    ];
    deliveryStatus = "woken";
    created = false;
    const response = await POST(request(envelope()));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      accepted: true,
      replayed: true,
    });
    expect(calls).toEqual(["persist"]);
  });

  test("fans a workspace event out once to every bound TaxCase", async () => {
    targets = [
      {
        operatingPackRunId: "tax_execution_1",
        taxRunId: "taxcase_opaque_1",
        leaseToken: "lease_1",
      },
      {
        operatingPackRunId: "tax_execution_2",
        taxRunId: "taxcase_opaque_2",
        leaseToken: "lease_2",
      },
    ];
    deliveryStatus = "received";
    const response = await POST(
      request(
        envelope({
          event: { ...event(), caseRef: null, kind: "consent.revoked" },
          payloadHash: taxDomainEventRequestHash({
            ...event(),
            caseRef: null,
            kind: "consent.revoked",
          }),
        }),
      ),
    );
    expect(response.status).toBe(200);
    expect(calls.filter((call) => call === "resume")).toHaveLength(2);
    expect(calls.filter((call) => call === "mark-woken")).toHaveLength(2);
  });

  test("distinguishes deterministic conflicts from persistence outages", async () => {
    receiveError = new MockConflictError("conflict");
    expect((await POST(request(envelope()))).status).toBe(409);
    receiveError = new Error("database unavailable");
    expect((await POST(request(envelope()))).status).toBe(503);
  });
});
