import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { facturaENeedsConsentProjectionV1Fixture } from "@tax-engine/browser-contracts/fixtures";
import type { NextRequest } from "next/server";

let grantValid = true;
let grantSubject = "22222222-2222-4222-8222-222222222222";
let grantScopes = ["tax.factoring.read"];

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
const projectionKey = "annual:2026";

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
        capability: "tax.factoring.read",
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
    "https://open-agents.test/api/bufi/tax-factoring-projection",
    {
      method: "POST",
      headers,
      body: JSON.stringify({ workspaceId, actorId, projectionKey }),
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
  grantScopes = ["tax.factoring.read"];
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

describe("BUFI Factura E factoring projection ingress", () => {
  test("forwards the scoped principal and returns the frozen projection", async () => {
    const assertion = principal();
    let captured: Request | undefined;
    const result = {
      state: "ready" as const,
      receipt: {
        version: "factura-e-factoring-projection-receipt-v1" as const,
        projectionKey,
        revision: 1,
        projectedAt: "2026-07-16T12:00:00.000Z",
        projection: facturaENeedsConsentProjectionV1Fixture,
      },
    };
    globalThis.fetch = mockFetch(async (input, init) => {
      captured = new Request(input, init);
      return Response.json(result);
    });

    const response = await POST(request({ assertion }));

    expect(response.status).toBe(200);
    expect(captured?.url).toBe(
      `https://tax-engine.test/v1/browser/factoring-projections/${workspaceId}/annual%3A2026`,
    );
    expect(captured?.headers.get("authorization")).toBe(`Bearer ${taxApiKey}`);
    expect(captured?.headers.get("x-tax-tenant-principal")).toBe(
      assertion.encoded,
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual(result);
  });

  test("fails closed for grant and principal failures before Tax", async () => {
    let calls = 0;
    globalThis.fetch = mockFetch(async () => {
      calls += 1;
      return Response.json({});
    });

    expect((await POST(request({ authorized: false }))).status).toBe(401);
    grantValid = false;
    expect((await POST(request())).status).toBe(403);
    grantValid = true;
    grantScopes = ["tax.snapshot.read"];
    expect((await POST(request())).status).toBe(403);
    grantScopes = ["tax.factoring.read"];
    expect((await POST(request({ includePrincipal: false }))).status).toBe(403);
    expect(calls).toBe(0);
  });

  test("preserves not-found and rejects malformed success data", async () => {
    const missing = {
      state: "unavailable" as const,
      code: "FACTURA_E_FACTORING_PROJECTION_NOT_FOUND" as const,
    };
    globalThis.fetch = mockFetch(async () =>
      Response.json(missing, { status: 404 }),
    );
    const notFound = await POST(request());
    expect(notFound.status).toBe(404);
    expect(await notFound.json()).toEqual(missing);

    globalThis.fetch = mockFetch(async () =>
      Response.json({ state: "ready", receipt: { projectionKey } }),
    );
    const malformed = await POST(request());
    expect(malformed.status).toBe(502);
    expect(await malformed.json()).toEqual({
      error: "TAX_FACTORING_PROJECTION_UPSTREAM_INVALID",
    });
  });
});
