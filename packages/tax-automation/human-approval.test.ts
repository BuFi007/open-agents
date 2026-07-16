import { describe, expect, test } from "bun:test";

import { TaxAutomationClient } from "./index";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const runId = "33333333-3333-4333-8333-333333333333";

describe("Tax invoice human approval client", () => {
  test("uses the isolated user-approval channel and verifies the returned run binding", async () => {
    let forwarded: Request | null = null;
    const client = new TaxAutomationClient({
      baseUrl: "https://tax.test",
      agentApiKey: "agent-api-key-at-least-sixteen",
      agentPrincipalSecret: "agent-principal-secret-at-least-thirty-two",
      userApprovalToken: "user-approval-token-at-least-thirty-two",
      fetchImpl: async (input, init) => {
        forwarded = input instanceof Request
          ? new Request(input, init)
          : new Request(String(input), init);
        return Response.json({
          data: {
            run: {
              runId,
              workspaceId,
              issuancePath: "wsfex_delegated",
              readinessState: "verified",
              intentState: "frozen",
              approvalState: "user_approved",
              issuanceState: "ready_for_wsfex",
              settlementState: "unobserved",
              fxIngressState: "unverified",
              taxDeclarationState: "not_ready",
              financeEligibility: "frozen",
              intentHash: "a".repeat(64),
              revision: 7,
            },
          },
        });
      },
    });
    const run = await client.approveInvoiceIntent({
      workspaceId,
      actorId,
      runId,
      intentHash: "a".repeat(64),
      idempotencyKey: "44444444-4444-4444-8444-444444444444",
    });
    expect(run.approvalState).toBe("user_approved");
    expect(forwarded!.url).toBe(`https://tax.test/v1/agent/runs/${runId}/user-approval`);
    expect(forwarded!.headers.get("x-tax-user-approval-token")).toBe(
      "user-approval-token-at-least-thirty-two",
    );
    expect(await forwarded!.json()).toEqual({
      actorId,
      intentHash: "a".repeat(64),
      idempotencyKey: "44444444-4444-4444-8444-444444444444",
    });
  });
});
