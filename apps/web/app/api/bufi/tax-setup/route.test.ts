import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { NextRequest } from "next/server";

let grantValid = true;
let grantSubject = "22222222-2222-4222-8222-222222222222";
let grantScopes = ["tax.setup.read"];

mock.module("@/lib/operating-packs/desk-grant", () => ({
  verifyDeskWorkspaceGrant: () =>
    grantValid ? { subject: grantSubject, scopes: grantScopes } : null,
}));

const originalFetch = globalThis.fetch;
const { POST } = await import("./route");
const workspaceId = "11111111-1111-4111-8111-111111111111";
const actorId = grantSubject;
const ingressSecret = "shared-ingress-secret-at-least-thirty-two";
const taxApiKey = "tax-engine-api-key-at-least-sixteen";

const profile = {
  profileId: `profile:ar:${workspaceId}`,
  workspaceId,
  jurisdiction: "AR",
  entityType: "individual",
  regimeId: "monotributo_exportador",
  ownerDomicileCountries: ["AR"],
  ownerTaxResidenceCountries: ["AR"],
  formationSubdivision: null,
  operatingSubdivisions: ["AR-C"],
  answers: [
    {
      questionId: "province",
      value: "AR-C",
      confirmationState: "user_confirmed",
    },
    {
      questionId: "exports_services",
      value: true,
      confirmationState: "user_confirmed",
    },
    {
      questionId: "export_pos_ready",
      value: false,
      confirmationState: "user_confirmed",
    },
  ],
  catalogueVersion: "ar-catalogue-2026-07-11",
  version: "profile-v1",
  confirmationState: "user_confirmed",
};

function mockFetch(
  implementation: (
    ...args: Parameters<typeof fetch>
  ) => ReturnType<typeof fetch>,
): typeof fetch {
  return Object.assign(implementation, { preconnect: () => undefined });
}

function catalogue(jurisdiction: "AR" | "US") {
  const regime =
    jurisdiction === "AR" ? "monotributo_exportador" : "llc_single_member";
  const entity = jurisdiction === "AR" ? "individual" : "llc";
  return {
    jurisdiction,
    version: `${jurisdiction.toLowerCase()}-catalogue-v1`,
    displayName: jurisdiction === "AR" ? "Argentina" : "United States",
    questions: [],
    regimes: [
      {
        id: regime,
        entityTypes: [entity],
        label: regime,
        description: "Server catalogue",
        requiredQuestions: [],
        ruleVersionIds: [],
      },
    ],
    rules: [],
  };
}

function assertion(
  capability: "profile:read" | "profile:confirm" | "snapshot:configure",
) {
  const encoded = Buffer.from(
    JSON.stringify({
      version: "tax-tenant-principal-v2",
      workspaceId,
      actorId,
      capability,
      expiresAt: new Date(Date.now() + 240_000).toISOString(),
    }),
  ).toString("base64url");
  return { encoded, signature: "f".repeat(64) };
}

function request(
  body: unknown,
  options: {
    authorized?: boolean;
    capability?: "profile:read" | "profile:confirm" | "snapshot:configure";
  } = {},
): NextRequest {
  const principal = options.capability ? assertion(options.capability) : null;
  return new Request("https://open-agents.test/api/bufi/tax-setup", {
    method: "POST",
    headers: {
      authorization:
        options.authorized === false
          ? "Bearer invalid"
          : `Bearer ${ingressSecret}`,
      "content-type": "application/json",
      "x-bufi-workspace-grant": "signed-workspace-grant",
      ...(principal
        ? {
            "x-tax-tenant-principal": principal.encoded,
            "x-tax-tenant-signature": principal.signature,
          }
        : {}),
    },
    body: JSON.stringify(body),
  }) as NextRequest;
}

beforeEach(() => {
  process.env.OPEN_AGENTS_BUFI_INGRESS_SECRET = ingressSecret;
  process.env.TAX_AUTOMATION_ENGINE_URL = "https://tax-engine.test";
  process.env.TAX_AUTOMATION_ENGINE_API_KEY = taxApiKey;
  process.env.TAX_AUTOMATION_ENGINE_AGENT_PRINCIPAL_HMAC_SECRET =
    "open-agents-tax-agent-principal-secret-32";
  grantValid = true;
  grantSubject = actorId;
  grantScopes = ["tax.setup.read"];
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

describe("BUFI Tax setup harness", () => {
  test("returns both server catalogues under a read-only workspace grant", async () => {
    globalThis.fetch = mockFetch(async () =>
      Response.json({ data: [catalogue("AR"), catalogue("US")] }),
    );
    const response = await POST(
      request({ operation: "catalogues", workspaceId, actorId }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      version: "tax-setup-operation-result-v1",
      operation: "catalogues",
      workspaceId,
      catalogues: [{ jurisdiction: "AR" }, { jurisdiction: "US" }],
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  test("forwards profile confirmation authority byte-for-byte", async () => {
    grantScopes = ["tax.profile.confirm"];
    const principal = assertion("profile:confirm");
    let captured: Request | null = null;
    globalThis.fetch = mockFetch(async (input, init) => {
      captured = new Request(input, init);
      return Response.json({ data: profile });
    });
    const incoming = new Request(
      "https://open-agents.test/api/bufi/tax-setup",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${ingressSecret}`,
          "content-type": "application/json",
          "x-bufi-workspace-grant": "signed-workspace-grant",
          "x-tax-tenant-principal": principal.encoded,
          "x-tax-tenant-signature": principal.signature,
        },
        body: JSON.stringify({
          operation: "profile_confirm",
          workspaceId,
          actorId,
          expectedVersion: null,
          profile: { ...profile, version: "profile-v0" },
        }),
      },
    ) as NextRequest;
    const response = await POST(incoming);
    expect(response.status).toBe(200);
    const forwarded = captured as Request | null;
    expect(forwarded?.headers.get("x-tax-tenant-principal")).toBe(
      principal.encoded,
    );
    expect(forwarded?.headers.get("x-tax-tenant-signature")).toBe(
      principal.signature,
    );
    expect(forwarded?.headers.get("authorization")).toBe(`Bearer ${taxApiKey}`);
    expect(JSON.stringify(await response.json())).not.toContain(
      principal.signature,
    );
  });

  test("denies cross-actor, cross-scope and cross-capability requests before Tax", async () => {
    let calls = 0;
    globalThis.fetch = mockFetch(async () => {
      calls += 1;
      return Response.json({ data: profile });
    });
    grantSubject = "33333333-3333-4333-8333-333333333333";
    expect(
      (
        await POST(
          request(
            { operation: "profile_read", workspaceId, actorId },
            { capability: "profile:read" },
          ),
        )
      ).status,
    ).toBe(403);
    grantSubject = actorId;
    grantScopes = ["tax.snapshot.configure"];
    expect(
      (
        await POST(
          request(
            { operation: "profile_read", workspaceId, actorId },
            { capability: "profile:read" },
          ),
        )
      ).status,
    ).toBe(403);
    grantScopes = ["tax.setup.read"];
    expect(
      (
        await POST(
          request(
            { operation: "profile_read", workspaceId, actorId },
            { capability: "profile:confirm" },
          ),
        )
      ).status,
    ).toBe(403);
    expect(calls).toBe(0);
  });

  test("sanitizes malformed and secret-bearing Tax responses", async () => {
    globalThis.fetch = mockFetch(async () =>
      Response.json({ data: [catalogue("AR")], rawApiKey: "secret" }),
    );
    const malformed = await POST(
      request({ operation: "catalogues", workspaceId, actorId }),
    );
    expect(malformed.status).toBe(502);
    expect(await malformed.json()).toEqual({
      error: "TAX_SETUP_UPSTREAM_INVALID",
    });

    globalThis.fetch = mockFetch(async () =>
      Response.json({ error: "secret database detail" }, { status: 500 }),
    );
    const unavailable = await POST(
      request({ operation: "catalogues", workspaceId, actorId }),
    );
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({
      error: "TAX_SETUP_UPSTREAM_UNAVAILABLE",
    });
  });
});
