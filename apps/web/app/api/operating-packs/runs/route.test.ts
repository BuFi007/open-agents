import { beforeEach, describe, expect, mock, test } from "bun:test";

let authenticated = true;
let owned = true;
let archived = false;
let startError = false;
let claimMode: "created" | "same" | "conflict" = "created";
let createCalls = 0;
let startCalls = 0;
let listedLimit: number | undefined;
let startedInput: Record<string, unknown> | undefined;
let storedGrant: string | undefined;

mock.module("@/lib/botid", () => ({
  checkBotProtection: async () => ({ isBot: false }),
}));

mock.module("@/lib/rate-limit", () => ({
  checkRateLimit: async () => null,
  rateLimitKey: (parts: unknown[]) => parts.join(":"),
}));

mock.module("@/lib/operating-packs/approval-token", () => ({
  getOperatingPackApprovalToken: () => "server-only-hook-token",
}));

mock.module("@/lib/operating-packs/credential-vault", () => ({
  storeOperatingPackWorkspaceGrant: async (input: { grant: string }) => {
    storedGrant = input.grant;
  },
  deleteOperatingPackWorkspaceGrant: async () => undefined,
}));

mock.module("@/app/api/chat/_lib/chat-context", () => ({
  requireAuthenticatedUser: async () =>
    authenticated
      ? { ok: true, userId: "user_1" }
      : {
          ok: false,
          response: Response.json(
            { error: "Not authenticated" },
            { status: 401 },
          ),
        },
  requireOwnedSessionChat: async () =>
    owned
      ? {
          ok: true,
          sessionRecord: { status: archived ? "archived" : "running" },
          chat: { modelId: "anthropic/claude-sonnet-4.6" },
        }
      : {
          ok: false,
          response: Response.json({ error: "Forbidden" }, { status: 403 }),
        },
}));

mock.module("@/lib/db/operating-pack-runs", () => ({
  createOperatingPackRun: async (input: Record<string, unknown>) => {
    createCalls += 1;
    if (claimMode === "created") return { created: true, run: input };
    return {
      created: false,
      run: {
        ...input,
        id: "op_existing",
        workflowRunId: "wfr_existing",
        status: "running",
        ...(claimMode === "conflict" ? { workflowId: "other_workflow" } : {}),
      },
    };
  },
  attachOperatingPackWorkflowRun: async () => undefined,
  updateOperatingPackRun: async () => undefined,
  listOwnedOperatingPackRuns: async (_userId: string, limit: number) => {
    listedLimit = limit;
    return [{ id: "op_recent", status: "running" }];
  },
}));

mock.module("workflow/api", () => ({
  start: async (_workflow: unknown, inputs: Record<string, unknown>[]) => {
    startCalls += 1;
    startedInput = inputs[0];
    if (startError) throw new Error("unavailable");
    return { runId: "wfr_1" };
  },
}));

mock.module("@/app/workflows/operating-pack", () => ({
  runOperatingPackWorkflow: async () => undefined,
}));

const { GET, POST } = await import("./route");

function request(body: Record<string, unknown>) {
  return new Request("https://open-agents.test/api/operating-packs/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validBody = {
  sessionId: "session_1",
  chatId: "chat_1",
  packId: "finance_ops",
  workflowId: "weekly_finance_review",
  harnessId: "claude-code",
  prompt: "Review the current workspace evidence",
  workspaceId: "11111111-1111-4111-8111-111111111111",
  workspaceGrant: "signed-workspace-grant".padEnd(100, "x"),
  idempotencyKey: "request:12345678",
} as const;

beforeEach(() => {
  authenticated = true;
  owned = true;
  archived = false;
  startError = false;
  claimMode = "created";
  createCalls = 0;
  startCalls = 0;
  listedLimit = undefined;
  startedInput = undefined;
  storedGrant = undefined;
});

describe("operating-pack run routes", () => {
  test("catalog requires authentication and exposes structured tax execution", async () => {
    authenticated = false;
    expect((await GET()).status).toBe(401);
    authenticated = true;
    const response = await GET(
      new Request("https://open-agents.test/api/operating-packs/runs?limit=25"),
    );
    const body = (await response.json()) as {
      packs: { id: string; workflows: { executionMode: string }[] }[];
      runs: { id: string; status: string }[];
    };
    expect(response.status).toBe(200);
    const tax = body.packs.find((pack) => pack.id === "tax_automation");
    expect(tax?.workflows[0]?.executionMode).toBe("structured_external_state");
    expect(body.runs).toEqual([{ id: "op_recent", status: "running" }]);
    expect(listedLimit).toBe(25);
    expect(
      (
        await GET(
          new Request(
            "https://open-agents.test/api/operating-packs/runs?limit=all",
          ),
        )
      ).status,
    ).toBe(400);
  });

  test("rejects cross-owner and archived workspaces before claiming", async () => {
    owned = false;
    expect((await POST(request(validBody))).status).toBe(403);
    archived = true;
    owned = true;
    expect((await POST(request(validBody))).status).toBe(400);
    expect(createCalls).toBe(0);
  });

  test("fails closed when the harness cannot enforce read-only builtins", async () => {
    const response = await POST(request({ ...validBody, harnessId: "codex" }));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      code: "HARNESS_PERMISSION_MODE_UNSUPPORTED",
    });
    expect(createCalls).toBe(0);
  });

  test("rejects unknown and prompt-started tax workflows", async () => {
    expect(
      (
        await POST(
          request({ ...validBody, packId: "tax_ops", workflowId: "file" }),
        )
      ).status,
    ).toBe(404);
    const taxResponse = await POST(
      request({
        ...validBody,
        packId: "tax_automation",
        workflowId: "ai_invoice_to_factura_e",
      }),
    );
    expect(taxResponse.status).toBe(422);
    expect(await taxResponse.json()).toMatchObject({
      code: "STRUCTURED_TAX_INVOICE_INGRESS_REQUIRED",
    });
    expect(createCalls).toBe(0);
  });

  test("claims idempotency before starting one durable workflow", async () => {
    const response = await POST(request(validBody));
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      workflowRunId: "wfr_1",
      status: "pending",
    });
    expect(createCalls).toBe(1);
    expect(startCalls).toBe(1);
    expect(storedGrant).toBe(validBody.workspaceGrant);
    expect(startedInput).not.toHaveProperty("workspaceGrant");
    expect(startedInput).not.toHaveProperty("approvalToken");
    expect(JSON.stringify(startedInput)).not.toContain(
      validBody.workspaceGrant,
    );
  });

  test("replays the same claim and rejects a conflicting claim", async () => {
    claimMode = "same";
    const replay = await POST(request(validBody));
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({
      executionId: "op_existing",
      replayed: true,
    });
    expect(startCalls).toBe(0);

    claimMode = "conflict";
    expect((await POST(request(validBody))).status).toBe(409);
    expect(startCalls).toBe(0);
  });

  test("records a visible start failure", async () => {
    startError = true;
    expect((await POST(request(validBody))).status).toBe(503);
    expect(startCalls).toBe(1);
  });
});
