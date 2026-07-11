import { beforeEach, describe, expect, mock, test } from "bun:test";

let authenticated = true;
let owned = true;
let archived = false;
let startError = false;
let claimMode: "created" | "same" | "conflict" = "created";
let createCalls = 0;
let startCalls = 0;

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
}));

mock.module("workflow/api", () => ({
  start: async () => {
    startCalls += 1;
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
});

describe("operating-pack run routes", () => {
  test("catalog requires authentication and excludes tax", async () => {
    authenticated = false;
    expect((await GET()).status).toBe(401);
    authenticated = true;
    const response = await GET();
    const body = (await response.json()) as { packs: { id: string }[] };
    expect(response.status).toBe(200);
    expect(body.packs.some((pack) => pack.id.includes("tax"))).toBe(false);
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

  test("rejects unknown and tax workflows", async () => {
    expect(
      (
        await POST(
          request({ ...validBody, packId: "tax_ops", workflowId: "file" }),
        )
      ).status,
    ).toBe(404);
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
