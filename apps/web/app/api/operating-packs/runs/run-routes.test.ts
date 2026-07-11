import { beforeEach, describe, expect, mock, test } from "bun:test";

let authenticated = true;
let owned = true;
let runStatus = "awaiting_approval";
let resumePayload: unknown;
let cancelled = false;
let updatedStatus: string | undefined;

const run = {
  id: "op_1",
  workflowRunId: "wfr_1",
  workspaceId: "ws_1",
  packId: "finance_ops",
  workflowId: "spend_approval",
  harnessId: "claude-code",
  status: "awaiting_approval",
  approvalId: "op_1:approval",
  approvalToken: "server-only-hook-token",
  result: null,
  errorCode: null,
  createdAt: new Date("2026-07-11T00:00:00Z"),
  updatedAt: new Date("2026-07-11T00:00:01Z"),
  finishedAt: null,
};

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
}));

mock.module("@/lib/rate-limit", () => ({
  checkRateLimit: async () => null,
  rateLimitKey: (parts: unknown[]) => parts.join(":"),
}));

mock.module("@/lib/operating-packs/approval-token", () => ({
  getOperatingPackApprovalToken: () => "server-only-hook-token",
}));

mock.module("@/lib/db/operating-pack-runs", () => ({
  getOwnedOperatingPackRun: async () =>
    owned ? { ...run, status: runStatus } : null,
  listOwnedOperatingPackTraces: async () =>
    owned
      ? {
          run,
          traces: [
            {
              id: "trace_2",
              runId: "op_1",
              workspaceId: "ws_1",
              sequence: 2,
              type: "artifact.emitted",
              agentId: null,
              summary: "Roster ready",
              data: null,
              createdAt: new Date("2026-07-11T00:00:02Z"),
            },
          ],
        }
      : null,
  updateOperatingPackRun: async (_id: string, input: { status: string }) => {
    updatedStatus = input.status;
  },
  appendOperatingPackTrace: async () => undefined,
}));

mock.module("workflow/api", () => ({
  getRun: () => ({
    status: Promise.resolve("running"),
    cancel: async () => {
      cancelled = true;
    },
  }),
  resumeHook: async (_token: string, payload: unknown) => {
    resumePayload = payload;
    return { runId: "wfr_1" };
  },
}));

const statusRoute = await import("./[runId]/route");
const traceRoute = await import("./[runId]/traces/route");
const approvalRoute = await import("./[runId]/approval/route");
const cancelRoute = await import("./[runId]/cancel/route");

const context = { params: Promise.resolve({ runId: "op_1" }) };

beforeEach(() => {
  authenticated = true;
  owned = true;
  runStatus = "awaiting_approval";
  resumePayload = undefined;
  cancelled = false;
  updatedStatus = undefined;
});

describe("operating-pack owner-scoped run APIs", () => {
  test("status is owner-scoped and never exposes the hook token", async () => {
    owned = false;
    expect(
      (await statusRoute.GET(new Request("https://test"), context)).status,
    ).toBe(404);
    owned = true;
    const response = await statusRoute.GET(
      new Request("https://test"),
      context,
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      id: "op_1",
      durableStatus: "running",
      approval: { id: "op_1:approval" },
    });
    expect(JSON.stringify(body)).not.toContain("server-only-hook-token");
  });

  test("traces are owner-scoped, bounded, and cursor based", async () => {
    const response = await traceRoute.GET(
      new Request("https://test/api?after=1&limit=20"),
      context,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ nextAfter: 2 });
    expect(
      (
        await traceRoute.GET(
          new Request("https://test/api?limit=9999"),
          context,
        )
      ).status,
    ).toBe(400);
    owned = false;
    expect(
      (await traceRoute.GET(new Request("https://test/api"), context)).status,
    ).toBe(404);
  });

  test("approval resumes only the server-held hook as the authenticated actor", async () => {
    const response = await approvalRoute.POST(
      new Request("https://test", {
        method: "POST",
        body: JSON.stringify({
          decision: "approved",
          reason: "Evidence reviewed",
        }),
      }),
      context,
    );
    expect(response.status).toBe(200);
    expect(resumePayload).toEqual({
      decision: "approved",
      reason: "Evidence reviewed",
      actorId: "user_1",
    });

    runStatus = "completed";
    expect(
      (
        await approvalRoute.POST(
          new Request("https://test", {
            method: "POST",
            body: JSON.stringify({
              decision: "rejected",
              reason: "Too late",
            }),
          }),
          context,
        )
      ).status,
    ).toBe(409);
  });

  test("cancel is idempotent and updates durable state", async () => {
    runStatus = "running";
    const response = await cancelRoute.POST(
      new Request("https://test"),
      context,
    );
    expect(response.status).toBe(200);
    expect(cancelled).toBe(true);
    expect(updatedStatus).toBe("cancelled");

    cancelled = false;
    runStatus = "completed";
    expect(
      await (
        await cancelRoute.POST(new Request("https://test"), context)
      ).json(),
    ).toEqual({ ok: true, status: "completed" });
    expect(cancelled).toBe(false);
  });

  test("every route rejects unauthenticated callers", async () => {
    authenticated = false;
    expect(
      (await statusRoute.GET(new Request("https://test"), context)).status,
    ).toBe(401);
    expect(
      (await traceRoute.GET(new Request("https://test"), context)).status,
    ).toBe(401);
    expect(
      (await cancelRoute.POST(new Request("https://test"), context)).status,
    ).toBe(401);
  });
});
