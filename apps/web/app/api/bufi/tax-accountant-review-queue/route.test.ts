import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { NextRequest } from "next/server";

let grantValid = true;
let grantSubject = "22222222-2222-4222-8222-222222222222";
let grantScopes = ["tax.accountant.review_queue.read"];

mock.module("@/lib/operating-packs/desk-grant", () => ({
  verifyDeskWorkspaceGrant: () =>
    grantValid ? { subject: grantSubject, scopes: grantScopes } : null,
}));

const originalFetch = globalThis.fetch;
const { POST } = await import("./route");

const secret = "shared-ingress-secret-at-least-thirty-two";
const taxApiKey = "tax-engine-api-key-at-least-sixteen";
const workspaceId = "11111111-1111-4111-8111-111111111111";
const actorId = grantSubject;

const queue = {
  version: "accountant-review-queue-v1" as const,
  accountantActorId: actorId,
  accountantOrganizationId: workspaceId,
  asOf: "2026-07-17T12:00:00.000Z",
  items: [],
  unavailableClients: [],
};

function mockFetch(
  implementation: (
    ...args: Parameters<typeof fetch>
  ) => ReturnType<typeof fetch>,
): typeof fetch {
  return Object.assign(implementation, { preconnect: () => undefined });
}

function principal() {
  return {
    encoded: Buffer.from(
      JSON.stringify({
        version: "tax-tenant-principal-v2",
        workspaceId,
        actorId,
        capability: "accountant:review-queue",
        expiresAt: new Date(Date.now() + 240_000).toISOString(),
      }),
    ).toString("base64url"),
    signature: "f".repeat(64),
  };
}

function request(options?: {
  authorized?: boolean;
  includePrincipal?: boolean;
  assertion?: ReturnType<typeof principal>;
}): NextRequest {
  const assertion = options?.assertion ?? principal();
  const headers: Record<string, string> = {
    authorization:
      options?.authorized === false ? "Bearer invalid" : `Bearer ${secret}`,
    "content-type": "application/json",
    "x-bufi-workspace-grant": "signed-workspace-grant",
  };
  if (options?.includePrincipal !== false) {
    headers["x-tax-tenant-principal"] = assertion.encoded;
    headers["x-tax-tenant-signature"] = assertion.signature;
  }
  return new Request(
    "https://open-agents.test/api/bufi/tax-accountant-review-queue",
    {
      method: "POST",
      headers,
      body: JSON.stringify({ workspaceId, actorId }),
    },
  ) as NextRequest;
}

beforeEach(() => {
  process.env.OPEN_AGENTS_BUFI_INGRESS_SECRET = secret;
  process.env.TAX_AUTOMATION_ENGINE_URL = "https://tax-engine.test";
  process.env.TAX_AUTOMATION_ENGINE_API_KEY = taxApiKey;
  process.env.TAX_AUTOMATION_ENGINE_AGENT_PRINCIPAL_HMAC_SECRET =
    "open-agents-tax-agent-principal-secret-32";
  grantValid = true;
  grantSubject = actorId;
  grantScopes = ["tax.accountant.review_queue.read"];
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

describe("BUFI accountant review queue ingress", () => {
  test("forwards the exact read principal and returns only the Tax queue", async () => {
    const assertion = principal();
    let captured: Request | undefined;
    globalThis.fetch = mockFetch(async (input, init) => {
      captured = new Request(input, init);
      return Response.json({ data: queue });
    });

    const response = await POST(request({ assertion }));
    expect(response.status).toBe(200);
    expect(captured?.url).toBe(
      "https://tax-engine.test/v1/accountant-review-queue",
    );
    expect(captured?.method).toBe("GET");
    expect(captured?.headers.get("authorization")).toBe(`Bearer ${taxApiKey}`);
    expect(captured?.headers.get("x-tax-tenant-principal")).toBe(
      assertion.encoded,
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ data: queue });
  });

  test("fails before Tax for bad ingress, grant, scope or principal", async () => {
    let calls = 0;
    globalThis.fetch = mockFetch(async () => {
      calls += 1;
      return Response.json({ data: queue });
    });
    expect((await POST(request({ authorized: false }))).status).toBe(401);
    grantValid = false;
    expect((await POST(request())).status).toBe(403);
    grantValid = true;
    grantScopes = ["tax.accountant.portfolio.read"];
    expect((await POST(request())).status).toBe(403);
    grantScopes = ["tax.accountant.review_queue.read"];
    expect((await POST(request({ includePrincipal: false }))).status).toBe(403);
    expect(calls).toBe(0);
  });

  test("does not reflect malformed or forbidden upstream bodies", async () => {
    globalThis.fetch = mockFetch(async () =>
      Response.json({ error: "raw-return-detail" }, { status: 403 }),
    );
    const forbidden = await POST(request());
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({
      error: "TAX_ACCOUNTANT_REVIEW_QUEUE_FORBIDDEN",
    });

    globalThis.fetch = mockFetch(async () =>
      Response.json({
        data: { ...queue, version: "accountant-review-queue-v2" },
      }),
    );
    const malformed = await POST(request());
    expect(malformed.status).toBe(503);
    expect(await malformed.json()).toEqual({
      error: "TAX_ACCOUNTANT_REVIEW_QUEUE_UNAVAILABLE",
    });
  });
});
