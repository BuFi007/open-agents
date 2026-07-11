import { beforeEach, describe, expect, mock, test } from "bun:test";

let grantValid = true;
let existingRun = false;
let runStatus = "awaiting_approval";
let runApprovalId: string | null = "op_1:approval";
let startCalls = 0;
let storedGrant: string | undefined;
let resumePayload: unknown;
let cancelled = false;
let updatedStatus: string | undefined;
let createdSession = false;
let savedComposition: readonly Record<string, unknown>[] | undefined;
let compositionRevision = 1;

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
  getWorkspaceOperatingPackRun: async () => ({
    ...run,
    status: runStatus,
    approvalId: runApprovalId,
  }),
  listWorkspaceOperatingPackRuns: async () => [
    { ...run, status: runStatus, approvalId: runApprovalId },
  ],
  listWorkspaceOperatingPackTraces: async () => ({
    run: { ...run, status: runStatus, approvalId: runApprovalId },
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

mock.module("@/lib/db/operating-pack-compositions", () => ({
  getWorkspaceOperatingPackComposition: async () => ({
    composition: { revision: compositionRevision, items: [] },
    revisions: [],
  }),
  getWorkspaceOperatingPackCompositionRevision: async () => ({
    revision: 1,
    items: [
      {
        instanceId: "canvas:finance_scorecard",
        packId: "finance_ops",
        widgetId: "finance_scorecard",
        kind: "kpi",
        enabled: true,
        order: 0,
        width: "half",
      },
    ],
  }),
  saveWorkspaceOperatingPackComposition: async (input: {
    items: readonly Record<string, unknown>[];
  }) => {
    savedComposition = input.items;
    compositionRevision += 1;
    return {
      saved: true,
      composition: { revision: compositionRevision, items: input.items },
    };
  },
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

mock.module("@/lib/operating-packs/control-token", () => ({
  getOperatingPackControlToken: (_runId: string, checkpoint: string) =>
    `server-control-token:${checkpoint}`,
  parseOperatingPackControlId: (value: string | null) =>
    value?.startsWith("control:") ? value.slice("control:".length) : null,
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
  runApprovalId = "op_1:approval";
  startCalls = 0;
  storedGrant = undefined;
  resumePayload = undefined;
  cancelled = false;
  updatedStatus = undefined;
  createdSession = false;
  savedComposition = undefined;
  compositionRevision = 1;
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

  test("requests a safe-checkpoint pause and resumes only the persisted control hook", async () => {
    runStatus = "running";
    const paused = await POST(
      request({
        action: "pause",
        workspaceId: run.workspaceId,
        workspaceGrant,
        runId: "op_1",
      }),
    );
    expect(paused.status).toBe(200);
    expect(await paused.json()).toMatchObject({
      status: "pause_requested",
      mode: "next_safe_checkpoint",
    });
    expect(updatedStatus).toBe("pause_requested");

    runStatus = "paused";
    runApprovalId = "control:before_agents";
    const resumed = await POST(
      request({
        action: "resume",
        workspaceId: run.workspaceId,
        workspaceGrant,
        runId: "op_1",
        reason: "Operator reviewed the plan",
      }),
    );
    expect(resumed.status).toBe(200);
    expect(await resumed.json()).toMatchObject({
      status: "resuming",
      checkpoint: "before_agents",
    });
    expect(resumePayload).toMatchObject({
      action: "resume",
      reason: "Operator reviewed the plan",
    });
  });

  test("saves and reverses manifest-validated multi-pack compositions", async () => {
    const items = [
      {
        instanceId: "canvas:finance_scorecard",
        packId: "finance_ops",
        widgetId: "finance_scorecard",
        kind: "kpi",
        enabled: true,
        order: 0,
        width: "half",
      },
      {
        instanceId: "canvas:grant_workflow",
        packId: "grant_ops",
        widgetId: "grant_workflow",
        kind: "workflow",
        enabled: true,
        order: 1,
        width: "full",
      },
    ];
    const saved = await POST(
      request({
        action: "save_composition",
        workspaceId: run.workspaceId,
        workspaceGrant,
        expectedRevision: 1,
        items,
      }),
    );
    expect(saved.status).toBe(200);
    expect(savedComposition?.map((item) => item.packId)).toEqual([
      "finance_ops",
      "grant_ops",
    ]);

    const reverted = await POST(
      request({
        action: "revert_composition",
        workspaceId: run.workspaceId,
        workspaceGrant,
        expectedRevision: 2,
        targetRevision: 1,
      }),
    );
    expect(reverted.status).toBe(200);
    expect(savedComposition).toHaveLength(1);

    const tax = await POST(
      request({
        action: "save_composition",
        workspaceId: run.workspaceId,
        workspaceGrant,
        expectedRevision: 3,
        items: [
          {
            instanceId: "canvas:tax",
            packId: "tax_automation",
            widgetId: "tax_readiness",
            kind: "workflow",
            enabled: true,
            order: 0,
            width: "full",
          },
        ],
      }),
    );
    expect(tax.status).toBe(400);
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
