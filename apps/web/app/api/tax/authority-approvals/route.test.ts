import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

const userId = "V1StGXR8_Z5jdHi6B-myT";
const workspaceId = "11111111-1111-4111-8111-111111111111";
const executionId = "22222222-2222-4222-8222-222222222222";
const workspaceGrant = "signed-workspace-grant".padEnd(100, "x");

let authenticated = true;
let grantSubject = userId;
let grantScopes: string[] = ["tax.invoice.authority.approve"];
let rateLimited: Response | null = null;

mock.module("@/app/api/chat/_lib/chat-context", () => ({
  requireAuthenticatedUser: async () =>
    authenticated
      ? { ok: true, userId }
      : {
          ok: false,
          response: Response.json(
            { error: "Not authenticated" },
            { status: 401 },
          ),
        },
}));

mock.module("@/lib/operating-packs/desk-grant", () => ({
  verifyDeskWorkspaceGrant: () => ({
    v: 1,
    workspaceId,
    subject: grantSubject,
    issuedAt: 1,
    expiresAt: 2,
    nonce: "44444444-4444-4444-8444-444444444444",
    scopes: grantScopes,
  }),
}));

mock.module("@/lib/rate-limit", () => ({
  checkRateLimit: async () => rateLimited,
  rateLimitKey: (parts: unknown[]) => parts.join(":"),
}));

const originalFetch = globalThis.fetch;
const originalEnvironment = {
  TAX_AUTOMATION_ENGINE_URL: process.env.TAX_AUTOMATION_ENGINE_URL,
  TAX_ENGINE_OPEN_AGENTS_APPROVAL_PRINCIPAL_HMAC_SECRET:
    process.env.TAX_ENGINE_OPEN_AGENTS_APPROVAL_PRINCIPAL_HMAC_SECRET,
  OPEN_AGENTS_TAX_APPROVAL_REF_HMAC_SECRET:
    process.env.OPEN_AGENTS_TAX_APPROVAL_REF_HMAC_SECRET,
  TAX_AUTOMATION_ENGINE_API_KEY: process.env.TAX_AUTOMATION_ENGINE_API_KEY,
  TAX_AUTOMATION_ENGINE_AGENT_PRINCIPAL_HMAC_SECRET:
    process.env.TAX_AUTOMATION_ENGINE_AGENT_PRINCIPAL_HMAC_SECRET,
  BUFI_AGENT_TOOL_BROKER_SECRET: process.env.BUFI_AGENT_TOOL_BROKER_SECRET,
  OPEN_AGENTS_BUFI_INGRESS_SECRET: process.env.OPEN_AGENTS_BUFI_INGRESS_SECRET,
};

const route = await import("./route");

beforeEach(() => {
  authenticated = true;
  grantSubject = userId;
  grantScopes = ["tax.invoice.authority.approve"];
  rateLimited = null;
  process.env.TAX_AUTOMATION_ENGINE_URL = "https://tax.test";
  process.env.TAX_ENGINE_OPEN_AGENTS_APPROVAL_PRINCIPAL_HMAC_SECRET =
    "oa-approval-principal-secret-at-least-32";
  process.env.OPEN_AGENTS_TAX_APPROVAL_REF_HMAC_SECRET =
    "oa-approval-ref-secret-at-least-32-bytes";
  process.env.TAX_AUTOMATION_ENGINE_API_KEY =
    "tax-generic-api-key-distinct-value";
  process.env.TAX_AUTOMATION_ENGINE_AGENT_PRINCIPAL_HMAC_SECRET =
    "tax-agent-principal-distinct-value-32";
  process.env.BUFI_AGENT_TOOL_BROKER_SECRET =
    "desk-broker-secret-distinct-value-32";
  process.env.OPEN_AGENTS_BUFI_INGRESS_SECRET =
    "open-agents-ingress-distinct-value-32";
});

afterAll(() => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function approvalRequest(
  overrides: Readonly<{
    body?: string;
    origin?: string;
    contentType?: string;
    contentLength?: string;
  }> = {},
): Request {
  return new Request("https://oa.test/api/tax/authority-approvals", {
    method: "POST",
    headers: {
      origin: overrides.origin ?? "https://oa.test",
      "content-type": overrides.contentType ?? "application/json",
      "x-bufi-workspace-grant": workspaceGrant,
      ...(overrides.contentLength
        ? { "content-length": overrides.contentLength }
        : {}),
    },
    body:
      overrides.body ??
      JSON.stringify({
        version: "oa-factura-e-human-approval-v1",
        decision: "approved",
        acknowledgement: "frozen_intent_hash_reviewed",
        executionId,
        workspaceId,
        intentHash: "a".repeat(64),
      }),
  });
}

function installFetch(
  implementation: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>,
): void {
  globalThis.fetch = Object.assign(implementation, {
    preconnect: originalFetch.preconnect,
  });
}

describe("human Factura E authority approval route", () => {
  test("binds the authenticated actor and returns only a safe receipt", async () => {
    let upstream: Request | null = null;
    installFetch(async (input, init) => {
      upstream =
        input instanceof Request
          ? new Request(input, init)
          : new Request(input.toString(), init);
      return Response.json({
        data: {
          version: "factura-e-authority-execution-receipt-v1",
          executionId,
          workspaceId,
          state: "approved",
          replayed: false,
          nextAction: "execute_with_one_use_approval",
        },
      });
    });

    const response = await route.POST(approvalRequest());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(body).toEqual({
      data: {
        version: "oa-factura-e-authority-approval-receipt-v1",
        executionId,
        workspaceId,
        intentHash: "a".repeat(64),
        status: "registered",
        replayed: false,
        nextStep: "request_execution_from_motora",
      },
    });
    expect(JSON.stringify(body)).not.toMatch(
      /approvalRef|principal|signature|secret|workspace-grant/i,
    );
    const forwarded = upstream as Request | null;
    const principal = JSON.parse(
      Buffer.from(
        forwarded!.headers.get("x-tax-authority-principal")!,
        "base64url",
      ).toString("utf8"),
    );
    expect(principal).toMatchObject({
      actorId: userId,
      workspaceId,
      capability: "factura-e:approval:register",
    });
  });

  test("requires session, same origin, actor-bound grant and narrow scope", async () => {
    let calls = 0;
    installFetch(async () => {
      calls += 1;
      throw new Error("unexpected");
    });

    authenticated = false;
    expect((await route.POST(approvalRequest())).status).toBe(401);
    authenticated = true;
    expect(
      (await route.POST(approvalRequest({ origin: "https://evil.test" })))
        .status,
    ).toBe(403);
    grantSubject = "other_OA-user-identity";
    expect((await route.POST(approvalRequest())).status).toBe(403);
    grantSubject = userId;
    grantScopes = ["tax.invoice.prepare"];
    expect((await route.POST(approvalRequest())).status).toBe(403);
    expect(calls).toBe(0);
  });

  test("rejects non-JSON, oversized and shape-drifted requests before Tax", async () => {
    let calls = 0;
    installFetch(async () => {
      calls += 1;
      throw new Error("unexpected");
    });
    expect(
      (
        await route.POST(
          approvalRequest({ contentType: "application/x-www-form-urlencoded" }),
        )
      ).status,
    ).toBe(415);
    expect(
      (await route.POST(approvalRequest({ contentLength: "4097" }))).status,
    ).toBe(400);
    expect(
      (
        await route.POST(
          approvalRequest({
            body: JSON.stringify({
              version: "oa-factura-e-human-approval-v1",
              decision: "approved",
              acknowledgement: "frozen_intent_hash_reviewed",
              executionId,
              workspaceId,
              intentHash: "a".repeat(64),
              actorId: userId,
            }),
          }),
        )
      ).status,
    ).toBe(400);
    expect(calls).toBe(0);
  });

  test("preserves only a bounded upstream error code", async () => {
    installFetch(async () =>
      Response.json(
        { error: "TAX_AUTHORITY_APPROVAL_IDEMPOTENCY_CONFLICT" },
        { status: 409 },
      ),
    );
    const response = await route.POST(approvalRequest());
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "TAX_AUTHORITY_APPROVAL_IDEMPOTENCY_CONFLICT",
    });
  });
});
