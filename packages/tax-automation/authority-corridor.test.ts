import { afterEach, describe, expect, test } from "bun:test";
import { createHash, createHmac } from "node:crypto";

import {
  TaxAuthorityApprovalClient,
  createServerHeldFacturaEApprovalRef,
} from "./authority-corridor";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const executionId = "22222222-2222-4222-8222-222222222222";
const secret = "open-agents-tax-approval-secret-111111111";
const approvalRef = "oa_approval_abcdefghijklmnopqrstuvwx";
const originalApiKey = process.env.TAX_AUTOMATION_ENGINE_API_KEY;

afterEach(() => {
  if (originalApiKey === undefined)
    delete process.env.TAX_AUTOMATION_ENGINE_API_KEY;
  else process.env.TAX_AUTOMATION_ENGINE_API_KEY = originalApiKey;
});

describe("Open Agents Tax authority approval principal", () => {
  test("registers only a body-bound one-use approval and returns a safe receipt", async () => {
    let forwarded: Request | null = null;
    const client = new TaxAuthorityApprovalClient({
      baseUrl: "https://tax.test",
      approvalPrincipalSecret: secret,
      now: () => new Date("2026-07-15T18:00:00.000Z"),
      fetchImpl: async (input, init) => {
        forwarded =
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
      },
    });
    const receipt = await client.registerFacturaEApproval({
      executionId,
      workspaceId,
      intentHash: "a".repeat(64),
      approvalRef,
      actorId: "oa:user:approver",
      idempotencyKey: "register-authority-approval-1",
    });
    expect(receipt).toEqual({
      version: "oa-factura-e-authority-approval-receipt-v1",
      executionId,
      workspaceId,
      intentHash: "a".repeat(64),
      status: "registered",
      replayed: false,
      nextStep: "request_execution_from_motora",
    });
    expect(JSON.stringify(receipt)).not.toMatch(
      /approvalRef|cuit|cae|vault|token/i,
    );

    const request = forwarded as Request | null;
    expect(request?.headers.has("authorization")).toBe(false);
    const rawBody = await request!.text();
    expect(JSON.parse(rawBody)).toEqual({
      version: "factura-e-authority-approval-register-v1",
      workspaceId,
      intentHash: "a".repeat(64),
      approvalRef,
      idempotencyKey: "register-authority-approval-1",
    });
    const encoded = request!.headers.get("x-tax-authority-principal")!;
    const principal = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    );
    expect(principal).toEqual({
      version: "tax-authority-principal-v1",
      workspaceId,
      actorId: "oa:user:approver",
      capability: "factura-e:approval:register",
      method: "POST",
      path: `/v1/authority/factura-e/intents/${executionId}/approvals`,
      bodyHash: createHash("sha256").update(rawBody).digest("hex"),
      expiresAt: "2026-07-15T18:01:00.000Z",
    });
    expect(request!.headers.get("x-tax-authority-signature")).toBe(
      createHmac("sha256", secret).update(encoded).digest("hex"),
    );
  });

  test("fails closed on response scope drift and a reused generic API key", async () => {
    const client = new TaxAuthorityApprovalClient({
      baseUrl: "https://tax.test",
      approvalPrincipalSecret: secret,
      fetchImpl: async () =>
        Response.json({
          data: {
            version: "factura-e-authority-execution-receipt-v1",
            executionId: "33333333-3333-4333-8333-333333333333",
            workspaceId,
            state: "approved",
            replayed: false,
            nextAction: "execute_with_one_use_approval",
          },
        }),
    });
    await expect(
      client.registerFacturaEApproval({
        executionId,
        workspaceId,
        intentHash: "a".repeat(64),
        approvalRef,
        actorId: "oa:user:approver",
        idempotencyKey: "register-authority-approval-2",
      }),
    ).rejects.toThrow("TAX_AUTHORITY_APPROVAL_RESPONSE_SCOPE_MISMATCH");

    process.env.TAX_AUTOMATION_ENGINE_API_KEY = secret;
    expect(
      () =>
        new TaxAuthorityApprovalClient({
          baseUrl: "https://tax.test",
          approvalPrincipalSecret: secret,
        }),
    ).toThrow("TAX_AUTHORITY_APPROVAL_PRINCIPAL_MUST_BE_DISTINCT");
    expect(createServerHeldFacturaEApprovalRef()).toMatch(
      /^oa_approval_[A-Za-z0-9_-]{32}$/,
    );
  });

  test("cancels an oversized chunked Tax approval response", async () => {
    let cancelled = false;
    const client = new TaxAuthorityApprovalClient({
      baseUrl: "https://tax.test",
      approvalPrincipalSecret: secret,
      fetchImpl: async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              controller.enqueue(new Uint8Array(40_000));
            },
            cancel() {
              cancelled = true;
            },
          }),
          { headers: { "content-type": "application/json" } },
        ),
    });
    await expect(
      client.registerFacturaEApproval({
        executionId,
        workspaceId,
        intentHash: "a".repeat(64),
        approvalRef,
        actorId: "oa:user:approver",
        idempotencyKey: "register-authority-approval-oversized",
      }),
    ).rejects.toThrow("TAX_AUTHORITY_APPROVAL_RESPONSE_INVALID");
    expect(cancelled).toBe(true);
  });

  test("rejects authority base URLs with ambient query or fragment state", () => {
    for (const baseUrl of [
      "https://tax.test/?tenant=other",
      "https://tax.test/#authority",
    ])
      expect(
        () =>
          new TaxAuthorityApprovalClient({
            baseUrl,
            approvalPrincipalSecret: secret,
          }),
      ).toThrow("TAX_AUTHORITY_APPROVAL_URL_CONFIGURATION_REQUIRED");
  });
});
