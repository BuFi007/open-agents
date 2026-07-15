import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { buildTaxSnapshotProblemV1 } from "@tax-engine/browser-contracts";
import { argentinaTaxWidgetSnapshotReceiptV1Fixture } from "@tax-engine/browser-contracts/fixtures";
import type { NextRequest } from "next/server";

let grantValid = true;
let grantSubject = "22222222-2222-4222-8222-222222222222";
let grantScopes = ["tax.snapshot.read"];

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
  const encoded = Buffer.from(
    JSON.stringify({
      version: "tax-tenant-principal-v2",
      workspaceId,
      actorId,
      capability: "snapshot:read",
      expiresAt: new Date(Date.now() + 240_000).toISOString(),
    }),
  ).toString("base64url");
  return {
    encoded,
    signature: "f".repeat(64),
  };
}

function request(
  body?: unknown,
  options?: { authorized?: boolean; includePrincipal?: boolean },
): NextRequest {
  const assertion = principal();
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
  return new Request("https://open-agents.test/api/bufi/tax-snapshot", {
    method: "POST",
    headers,
    body: JSON.stringify(
      body === undefined ? { workspaceId, actorId, projectionKey } : body,
    ),
  }) as NextRequest;
}

beforeEach(() => {
  process.env.OPEN_AGENTS_BUFI_INGRESS_SECRET = secret;
  process.env.TAX_AUTOMATION_ENGINE_URL = "https://tax-engine.test";
  process.env.TAX_AUTOMATION_ENGINE_API_KEY = taxApiKey;
  process.env.TAX_AUTOMATION_ENGINE_AGENT_PRINCIPAL_HMAC_SECRET =
    "open-agents-tax-agent-principal-secret-32";
  grantValid = true;
  grantSubject = actorId;
  grantScopes = ["tax.snapshot.read"];
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

describe("BUFI durable Tax snapshot ingress", () => {
  test("forwards the scoped principal byte-for-byte and returns no secrets", async () => {
    const assertion = principal();
    let captured: Request | undefined;
    globalThis.fetch = mockFetch(async (input, init) => {
      captured = new Request(input, init);
      return Response.json({
        ok: true,
        data: argentinaTaxWidgetSnapshotReceiptV1Fixture,
      });
    });

    const incoming = new Request(
      "https://open-agents.test/api/bufi/tax-snapshot",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${secret}`,
          "content-type": "application/json",
          "x-bufi-workspace-grant": "signed-workspace-grant",
          "x-tax-tenant-principal": assertion.encoded,
          "x-tax-tenant-signature": assertion.signature,
        },
        body: JSON.stringify({ workspaceId, actorId, projectionKey }),
      },
    ) as NextRequest;
    const response = await POST(incoming);

    expect(response.status).toBe(200);
    expect(captured?.url).toBe(
      `https://tax-engine.test/v1/browser/snapshots/${workspaceId}/annual%3A2026`,
    );
    expect(captured?.headers.get("authorization")).toBe(`Bearer ${taxApiKey}`);
    expect(captured?.headers.get("x-tax-tenant-principal")).toBe(
      assertion.encoded,
    );
    expect(captured?.headers.get("x-tax-tenant-signature")).toBe(
      assertion.signature,
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const responseBody = JSON.stringify(await response.json());
    expect(responseBody).not.toContain(assertion.encoded);
    expect(responseBody).not.toContain(assertion.signature);
    expect(responseBody).not.toContain(taxApiKey);
  });

  test("rejects ingress, grant, actor, scope and principal failures before Tax", async () => {
    let calls = 0;
    globalThis.fetch = mockFetch(async () => {
      calls += 1;
      return Response.json({
        ok: true,
        data: argentinaTaxWidgetSnapshotReceiptV1Fixture,
      });
    });

    expect((await POST(request(undefined, { authorized: false }))).status).toBe(
      401,
    );
    grantValid = false;
    expect((await POST(request())).status).toBe(403);
    grantValid = true;
    grantSubject = "33333333-3333-4333-8333-333333333333";
    expect((await POST(request())).status).toBe(403);
    grantSubject = actorId;
    grantScopes = ["knowledge.read"];
    expect((await POST(request())).status).toBe(403);
    grantScopes = ["tax.snapshot.read"];
    expect(
      (await POST(request(undefined, { includePrincipal: false }))).status,
    ).toBe(403);
    expect(calls).toBe(0);
  });

  test("preserves Tax snapshot lifecycle statuses without falling back", async () => {
    for (const code of [
      "TAX_SNAPSHOT_NOT_FOUND",
      "TAX_SNAPSHOT_STALE",
      "TAX_SNAPSHOT_EXPIRED",
    ] as const) {
      const problem = buildTaxSnapshotProblemV1(code);
      globalThis.fetch = mockFetch(async () =>
        Response.json({ ok: false, problem }, { status: problem.status }),
      );
      const response = await POST(request());
      expect(response.status).toBe(problem.status);
      expect(await response.json()).toEqual({ ok: false, problem });
    }
  });

  test("does not reflect upstream forbidden details to the caller", async () => {
    globalThis.fetch = mockFetch(async () =>
      Response.json({ error: "sensitive-upstream-detail" }, { status: 403 }),
    );

    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "TAX_SNAPSHOT_FORBIDDEN",
    });
  });

  test("fails closed for an unknown browser snapshot wire version", async () => {
    globalThis.fetch = mockFetch(async () =>
      Response.json({
        ok: true,
        data: {
          ...argentinaTaxWidgetSnapshotReceiptV1Fixture,
          version: "tax-browser-snapshot-receipt-v2",
        },
      }),
    );
    const response = await POST(request());
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: "TAX_SNAPSHOT_UPSTREAM_INVALID",
    });
  });
});
