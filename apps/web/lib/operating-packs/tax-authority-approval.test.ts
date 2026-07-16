import { describe, expect, test } from "bun:test";

import { registerHumanFacturaEAuthorityApproval } from "./tax-authority-approval";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const executionId = "22222222-2222-4222-8222-222222222222";
const actorId = "33333333-3333-4333-8333-333333333333";
const principalSecret = "oa-approval-principal-secret-at-least-32";
const approvalRefSecret = "oa-approval-ref-secret-at-least-32-bytes";

const decision = {
  version: "oa-factura-e-human-approval-v1" as const,
  decision: "approved" as const,
  acknowledgement: "frozen_intent_hash_reviewed" as const,
  executionId,
  workspaceId,
  intentHash: "a".repeat(64),
  actorId,
};

function environment(overrides: Record<string, string | undefined> = {}) {
  return {
    NODE_ENV: "test",
    TAX_AUTOMATION_ENGINE_URL: "https://tax.test",
    TAX_ENGINE_OPEN_AGENTS_APPROVAL_PRINCIPAL_HMAC_SECRET: principalSecret,
    OPEN_AGENTS_TAX_APPROVAL_REF_HMAC_SECRET: approvalRefSecret,
    TAX_AUTOMATION_ENGINE_API_KEY: "tax-generic-api-key-distinct-value",
    TAX_AUTOMATION_ENGINE_AGENT_PRINCIPAL_HMAC_SECRET:
      "tax-agent-principal-distinct-value-32",
    BUFI_AGENT_TOOL_BROKER_SECRET: "desk-broker-secret-distinct-value-32",
    OPEN_AGENTS_BUFI_INGRESS_SECRET: "open-agents-ingress-distinct-value-32",
    ...overrides,
  };
}

describe("authenticated human Tax authority approval", () => {
  test("derives a stable server-held approval and binds the authenticated actor", async () => {
    const forwarded: Request[] = [];
    const fetchImpl = async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const request =
        input instanceof Request
          ? new Request(input, init)
          : new Request(input.toString(), init);
      forwarded.push(request);
      return Response.json({
        data: {
          version: "factura-e-authority-execution-receipt-v1",
          executionId,
          workspaceId,
          state: "approved",
          replayed: forwarded.length > 1,
          nextAction: "execute_with_one_use_approval",
        },
      });
    };

    const first = await registerHumanFacturaEAuthorityApproval(decision, {
      environment: environment(),
      fetchImpl,
      now: () => new Date("2026-07-15T18:00:00.000Z"),
    });
    const replay = await registerHumanFacturaEAuthorityApproval(decision, {
      environment: environment(),
      fetchImpl,
      now: () => new Date("2026-07-15T18:00:00.000Z"),
    });

    expect(first).toMatchObject({
      executionId,
      workspaceId,
      intentHash: "a".repeat(64),
      status: "registered",
      replayed: false,
      nextStep: "request_execution_from_motora",
    });
    expect(replay.replayed).toBe(true);
    const bodies = await Promise.all(
      forwarded.map((request) => request.text()),
    );
    expect(bodies[0]).toBe(bodies[1]);
    const upstreamBody = JSON.parse(bodies[0]!) as Record<string, unknown>;
    expect(upstreamBody.idempotencyKey).toMatch(
      /^oa-human-approval:[a-f0-9]{64}$/,
    );
    expect(upstreamBody.approvalRef).toMatch(/^oa_approval_[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(first)).not.toMatch(
      /approvalRef|principal|secret|signature/i,
    );

    const encoded = forwarded[0]!.headers.get("x-tax-authority-principal")!;
    const principal = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    expect(principal).toMatchObject({
      workspaceId,
      actorId,
      capability: "factura-e:approval:register",
      method: "POST",
    });
  });

  test("fails closed on reused secrets and without explicit production approval", async () => {
    await expect(
      registerHumanFacturaEAuthorityApproval(decision, {
        environment: environment({
          OPEN_AGENTS_TAX_APPROVAL_REF_HMAC_SECRET: principalSecret,
        }),
      }),
    ).rejects.toThrow("TAX_AUTHORITY_APPROVAL_SECRET_CONFIGURATION_REQUIRED");

    await expect(
      registerHumanFacturaEAuthorityApproval(decision, {
        environment: environment({ NODE_ENV: "production" }),
      }),
    ).rejects.toThrow("TAX_AUTHORITY_APPROVAL_PRODUCTION_APPROVAL_REQUIRED");
  });

  test("rejects decision-shaped drift before contacting Tax", async () => {
    let contacted = false;
    await expect(
      registerHumanFacturaEAuthorityApproval(
        {
          ...decision,
          acknowledgement: "not_reviewed" as never,
        },
        {
          environment: environment(),
          fetchImpl: async () => {
            contacted = true;
            throw new Error("unexpected");
          },
        },
      ),
    ).rejects.toThrow();
    expect(contacted).toBe(false);
  });
});
