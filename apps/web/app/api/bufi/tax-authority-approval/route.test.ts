import { beforeEach, describe, expect, mock, test } from "bun:test";
import { z } from "zod";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const executionId = "33333333-3333-4333-8333-333333333333";
const secret = "shared-ingress-secret-at-least-thirty-two";
let grantScopes = ["tax.invoice.authority.approve"];
let registered: Record<string, unknown> | null = null;

mock.module("@/lib/operating-packs/desk-grant", () => ({
  verifyDeskWorkspaceGrant: () => ({ subject: actorId, scopes: grantScopes }),
}));
mock.module("@/lib/rate-limit", () => ({
  checkRateLimit: async () => null,
  rateLimitKey: (parts: string[]) => parts.join(":"),
}));
mock.module("@/lib/operating-packs/tax-authority-approval", () => ({
  HumanFacturaEAuthorityApprovalSchema: z.object({
    version: z.literal("oa-factura-e-human-approval-v1"),
    decision: z.literal("approved"),
    acknowledgement: z.literal("frozen_intent_hash_reviewed"),
    executionId: z.string().uuid(),
    workspaceId: z.string().uuid(),
    intentHash: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict(),
  registerHumanFacturaEAuthorityApproval: async (input: Record<string, unknown>) => {
    registered = input;
    return { status: "registered", executionId, workspaceId };
  },
}));

const { POST } = await import("./route");

const body = {
  version: "oa-factura-e-human-approval-v1",
  decision: "approved",
  acknowledgement: "frozen_intent_hash_reviewed",
  executionId,
  workspaceId,
  intentHash: "a".repeat(64),
  actorId,
};

function request(value: unknown = body) {
  return new Request("https://open-agents.test/api/bufi/tax-authority-approval", {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
      "x-bufi-workspace-grant": "signed-grant".padEnd(100, "x"),
    },
    body: JSON.stringify(value),
  });
}

beforeEach(() => {
  process.env.OPEN_AGENTS_BUFI_INGRESS_SECRET = secret;
  grantScopes = ["tax.invoice.authority.approve"];
  registered = null;
});

describe("BUFI Tax authority approval ingress", () => {
  test("turns one grant-scoped Desk decision into an OA-held approval", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(registered).toMatchObject({ actorId, workspaceId, executionId });
    expect(JSON.stringify(await response.json())).not.toContain("signed-grant");
  });

  test("requires the dedicated authority scope and exact frozen-hash acknowledgement", async () => {
    grantScopes = ["tax.invoice.prepare"];
    expect((await POST(request())).status).toBe(403);
    expect((await POST(request({ ...body, acknowledgement: "yes" }))).status).toBe(400);
    expect(registered).toBeNull();
  });
});
