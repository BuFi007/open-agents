import { describe, expect, test } from "bun:test";

import {
  TaxAutomationClient,
  TaxAutomationRequestError,
  type ForwardedTaxTenantPrincipalHeaders,
} from "./index";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const apiKey = "tax-api-key-at-least-sixteen";

const profile = {
  profileId: `profile:ar:${workspaceId}`,
  workspaceId,
  jurisdiction: "AR" as const,
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
      confirmationState: "user_confirmed" as const,
    },
    {
      questionId: "exports_services",
      value: true,
      confirmationState: "user_confirmed" as const,
    },
    {
      questionId: "export_pos_ready",
      value: false,
      confirmationState: "user_confirmed" as const,
    },
  ],
  catalogueVersion: "ar-catalogue-2026-07-11",
  version: "profile-v1",
  confirmationState: "user_confirmed" as const,
};

function principal(
  capability: "profile:read" | "profile:confirm" | "snapshot:configure",
  claimedWorkspaceId = workspaceId,
): ForwardedTaxTenantPrincipalHeaders {
  return {
    "x-tax-tenant-principal": Buffer.from(
      JSON.stringify({
        version: "tax-tenant-principal-v2",
        workspaceId: claimedWorkspaceId,
        actorId,
        capability,
        expiresAt: new Date(Date.now() + 240_000).toISOString(),
      }),
      "utf8",
    ).toString("base64url"),
    "x-tax-tenant-signature": "f".repeat(64),
  };
}

describe("Tax setup client", () => {
  test("forwards the exact profile principal and treats not-found as setup state", async () => {
    let captured: Request | null = null;
    const headers = principal("profile:read");
    const client = new TaxAutomationClient({
      baseUrl: "https://tax.test",
      agentApiKey: apiKey,
      agentPrincipalSecret: "open-agents-tax-agent-principal-secret-32",
      fetchImpl: async (input, init) => {
        captured =
          input instanceof Request
            ? new Request(input, init)
            : new Request(input.toString(), init);
        return Response.json({ error: "NOT_FOUND" }, { status: 404 });
      },
    });
    expect(await client.getTaxProfile(workspaceId, actorId, headers)).toEqual({
      version: "tax-setup-operation-result-v1",
      operation: "profile_read",
      workspaceId,
      profile: null,
    });
    const forwarded = captured as Request | null;
    expect(forwarded?.headers.get("x-tax-tenant-principal")).toBe(
      headers["x-tax-tenant-principal"],
    );
    expect(forwarded?.headers.get("x-tax-tenant-signature")).toBe(
      headers["x-tax-tenant-signature"],
    );
    expect(forwarded?.headers.get("authorization")).toBe(`Bearer ${apiKey}`);
  });

  test("denies a cross-capability setup principal before calling Tax", async () => {
    let calls = 0;
    const client = new TaxAutomationClient({
      baseUrl: "https://tax.test",
      agentApiKey: apiKey,
      agentPrincipalSecret: "open-agents-tax-agent-principal-secret-32",
      fetchImpl: async () => {
        calls += 1;
        return Response.json({ data: profile });
      },
    });
    await expect(
      client.getTaxProfile(workspaceId, actorId, principal("profile:confirm")),
    ).rejects.toBeInstanceOf(TaxAutomationRequestError);
    await expect(
      client.getTaxProfile(
        workspaceId,
        actorId,
        principal("profile:read", "33333333-3333-4333-8333-333333333333"),
      ),
    ).rejects.toBeInstanceOf(TaxAutomationRequestError);
    expect(calls).toBe(0);
  });

  test("uses PUT for configuration and strictly binds the returned projection", async () => {
    let captured: Request | null = null;
    const client = new TaxAutomationClient({
      baseUrl: "https://tax.test",
      agentApiKey: apiKey,
      agentPrincipalSecret: "open-agents-tax-agent-principal-secret-32",
      fetchImpl: async (input, init) => {
        captured =
          input instanceof Request
            ? new Request(input, init)
            : new Request(input.toString(), init);
        return Response.json({
          data: {
            configuration: {
              version: "tax-snapshot-projection-configuration-v1",
              workspaceId,
              period: { start: "2026-01-01", end: "2026-12-31" },
              displayCurrency: "ARS",
              dataScope: {
                mode: "selected",
                sourceIds: ["bufi-invoice", "magic-inbox"],
                includeKnowledgeGraph: false,
              },
            },
            projectionKey: "annual:2026",
            configHash: "a".repeat(64),
            replayed: false,
          },
        });
      },
    });
    const result = await client.configureTaxSnapshot(
      {
        workspaceId,
        actorId,
        projectionKey: "annual:2026",
        expectedConfigHash: null,
        period: { start: "2026-01-01", end: "2026-12-31" },
        displayCurrency: "ARS",
        dataScope: {
          mode: "selected",
          sourceIds: ["bufi-invoice", "magic-inbox"],
          includeKnowledgeGraph: false,
        },
      },
      principal("snapshot:configure"),
    );
    const forwarded = captured as Request | null;
    expect(forwarded?.method).toBe("PUT");
    expect(forwarded?.url).toEndWith(
      `/v1/snapshot-configurations/${workspaceId}/annual%3A2026`,
    );
    expect(result).toMatchObject({
      operation: "configuration_put",
      replayed: false,
      configuration: { projectionKey: "annual:2026" },
    });
  });

  test("rejects malformed successful Tax bodies without reflecting them", async () => {
    const client = new TaxAutomationClient({
      baseUrl: "https://tax.test",
      agentApiKey: apiKey,
      agentPrincipalSecret: "open-agents-tax-agent-principal-secret-32",
      fetchImpl: async () =>
        Response.json({ data: { ...profile, rawTin: "must-not-pass" } }),
    });
    await expect(
      client.getTaxProfile(workspaceId, actorId, principal("profile:read")),
    ).rejects.toMatchObject({
      code: "TAX_SETUP_UPSTREAM_INVALID",
      status: 502,
    });
  });
});
