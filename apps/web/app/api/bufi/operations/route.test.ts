import { beforeEach, describe, expect, mock, test } from "bun:test";

let grantValid = true;
let existingRun = false;
let runStatus = "awaiting_approval";
let startCalls = 0;
let storedGrant: string | undefined;
let resumePayload: unknown;
let cancelled = false;
let updatedStatus: string | undefined;
let createdSession = false;

const run = {
  id: "op_1",
  workflowRunId: "wfr_1",
  workspaceId: "11111111-1111-4111-8111-111111111111",
  sessionId: "session_1",
  chatId: "chat_1",
  userId: "desk_shadow",
  packId: "finance_ops",
  workflowId: "weekly_finance_review",
  harnessId: "claude-code",
  idempotencyKey: "desk-command:12345678",
  requestHash: "request-hash",
  status: "awaiting_approval",
  approvalId: "op_1:approval",
  result: null,
  errorCode: null,
  createdAt: new Date("2026-07-11T00:00:00Z"),
  updatedAt: new Date("2026-07-11T00:00:01Z"),
  finishedAt: null,
};

mock.module("@/lib/db/client", () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => [] }) }),
    }),
    insert: () => ({
      values: () => ({ onConflictDoNothing: async () => undefined }),
    }),
    delete: () => ({ where: async () => undefined }),
  },
}));

mock.module("@/lib/db/schema", () => ({
  users: { id: "id" },
  sessions: { id: "id" },
}));

mock.module("drizzle-orm", () => ({ eq: () => ({}) }));

mock.module("@/lib/operating-packs/desk-grant", () => ({
  verifyDeskWorkspaceGrant: () =>
    grantValid
      ? {
          subject: "22222222-2222-4222-8222-222222222222",
          workspaceId: run.workspaceId,
        }
      : null,
}));

mock.module("@/lib/db/operating-pack-runs", () => ({
  createOperatingPackRun: async (input: Record<string, unknown>) =>
    existingRun
      ? { created: false, run: { ...run, requestHash: input.requestHash } }
      : { created: true, run: input },
  attachOperatingPackWorkflowRun: async () => undefined,
  getWorkspaceOperatingPackRun: async () => ({ ...run, status: runStatus }),
  listWorkspaceOperatingPackRuns: async () => [{ ...run, status: runStatus }],
  listWorkspaceOperatingPackTraces: async () => ({
    run: { ...run, status: runStatus },
    traces: [
      {
        id: "trace_1",
        sequence: 1,
        type: "workflow.started",
        summary: "Started",
      },
    ],
  }),
  updateOperatingPackRun: async (_id: string, input: { status: string }) => {
    updatedStatus = input.status;
  },
  appendOperatingPackTrace: async () => undefined,
}));

mock.module("@/lib/db/sessions", () => ({
  createSessionWithInitialChat: async () => {
    createdSession = true;
  },
}));

mock.module("@/lib/operating-packs/credential-vault", () => ({
  storeOperatingPackWorkspaceGrant: async (input: { grant: string }) => {
    storedGrant = input.grant;
  },
  deleteOperatingPackWorkspaceGrant: async () => undefined,
}));

mock.module("@/lib/operating-packs/approval-token", () => ({
  getOperatingPackApprovalToken: () => "server-hook-token",
}));

mock.module("@/app/workflows/operating-pack", () => ({
  runOperatingPackWorkflow: async () => undefined,
}));

mock.module("workflow/api", () => ({
  start: async () => {
    startCalls += 1;
    return { runId: "wfr_new" };
  },
  getRun: () => ({
    status: Promise.resolve("running"),
    cancel: async () => {
      cancelled = true;
    },
  }),
  resumeHook: async (_token: string, payload: unknown) => {
    resumePayload = payload;
  },
}));

mock.module("@/lib/models", () => ({ APP_DEFAULT_MODEL_ID: "test/model" }));

const { GET, POST } = await import("./route");
const secret = "shared-ingress-secret-at-least-sixteen";
const workspaceGrant = "signed-workspace-grant".padEnd(100, "x");

function request(body: Record<string, unknown>) {
  return new Request("https://open-agents.test/api/bufi/operations", {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  process.env.OPEN_AGENTS_BUFI_INGRESS_SECRET = secret;
  grantValid = true;
  existingRun = false;
  runStatus = "awaiting_approval";
  startCalls = 0;
  storedGrant = undefined;
  resumePayload = undefined;
  cancelled = false;
  updatedStatus = undefined;
  createdSession = false;
});

describe("Desk B2B operations API", () => {
  test("lists only harness workflows and returns scoped traces", async () => {
    const list = await GET(
      new Request(
        `https://open-agents.test/api/bufi/operations?workspaceId=${run.workspaceId}`,
        {
          headers: {
            authorization: `Bearer ${secret}`,
            "x-bufi-workspace-grant": workspaceGrant,
          },
        },
      ),
    );
    const listBody = await list.json();
    expect(list.status).toBe(200);
    expect(listBody.packs.length).toBeGreaterThan(0);
    expect(JSON.stringify(listBody)).not.toContain("factura_e");

    const detail = await GET(
      new Request(
        `https://open-agents.test/api/bufi/operations?workspaceId=${run.workspaceId}&runId=op_1`,
        {
          headers: {
            authorization: `Bearer ${secret}`,
            "x-bufi-workspace-grant": workspaceGrant,
          },
        },
      ),
    );
    expect(await detail.json()).toMatchObject({
      run: { id: "op_1", durableStatus: "running" },
      traces: [{ id: "trace_1" }],
    });
  });

  test("creates a bridge session and starts one grant-bound durable workflow", async () => {
    const response = await POST(
      request({
        action: "start",
        workspaceId: run.workspaceId,
        workspaceGrant,
        packId: "finance_ops",
        workflowId: "weekly_finance_review",
        harnessId: "claude-code",
        prompt: "Review workspace evidence",
        idempotencyKey: "desk-command:12345678",
      }),
    );
    expect(response.status).toBe(202);
    expect(createdSession).toBe(true);
    expect(storedGrant).toBe(workspaceGrant);
    expect(startCalls).toBe(1);
    expect(JSON.stringify(await response.json())).not.toContain(workspaceGrant);
  });

  test("resumes approval as the derived Desk actor and cancels idempotently", async () => {
    expect(
      (
        await POST(
          request({
            action: "decide",
            workspaceId: run.workspaceId,
            workspaceGrant,
            runId: "op_1",
            decision: "approved",
            reason: "Evidence reviewed",
          }),
        )
      ).status,
    ).toBe(200);
    expect(resumePayload).toMatchObject({
      decision: "approved",
      reason: "Evidence reviewed",
    });
    expect(String((resumePayload as { actorId: string }).actorId)).toStartWith(
      "desk_",
    );

    runStatus = "running";
    expect(
      (
        await POST(
          request({
            action: "cancel",
            workspaceId: run.workspaceId,
            workspaceGrant,
            runId: "op_1",
          }),
        )
      ).status,
    ).toBe(200);
    expect(cancelled).toBe(true);
    expect(updatedStatus).toBe("cancelled");
  });

  test("fails closed for invalid bearer, grant and workspace input", async () => {
    expect(
      (
        await GET(
          new Request(
            `https://open-agents.test/api/bufi/operations?workspaceId=${run.workspaceId}`,
          ),
        )
      ).status,
    ).toBe(401);
    grantValid = false;
    expect(
      (
        await POST(
          request({
            action: "cancel",
            workspaceId: run.workspaceId,
            workspaceGrant,
            runId: "op_1",
          }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await POST(
          request({
            action: "cancel",
            workspaceId: "wrong",
            workspaceGrant,
            runId: "op_1",
          }),
        )
      ).status,
    ).toBe(400);
  });
});
