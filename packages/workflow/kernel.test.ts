import { describe, expect, it } from "bun:test";
import {
  createWorkflow,
  resumeWorkflow,
  runWorkflow,
  type WorkflowRun,
  type WorkflowStore,
} from "./index";

const store = (): WorkflowStore & {
  events: unknown[];
  runs: WorkflowRun[];
  runById: Map<string, WorkflowRun>;
} => ({
  events: [],
  runs: [],
  runById: new Map(),
  async append(_id, event) {
    this.events.push(event);
  },
  async save(run) {
    this.runs.push(run);
    this.runById.set(run.runId, structuredClone(run));
  },
  async load(runId) {
    return this.runById.get(runId) ?? null;
  },
});

describe("durable workflow kernel", () => {
  it("fans out independent steps and joins dependencies", async () => {
    const seen: string[] = [];
    const persisted = store();
    const run = await runWorkflow(
      createWorkflow({
        id: "plan",
        workspaceId: "ws",
        input: {},
        budgetMs: 1000,
        steps: [
          {
            id: "cfo",
            agentId: "cfo",
            run: async () => {
              seen.push("cfo");
              return 1;
            },
          },
          {
            id: "budget",
            agentId: "budgeting",
            run: async () => {
              seen.push("budget");
              return 2;
            },
          },
          {
            id: "join",
            agentId: "bufi",
            dependsOn: ["cfo", "budget"],
            run: async () => seen.join(","),
          },
        ],
      }),
      { store: persisted },
    );
    expect(run.status).toBe("completed");
    expect(run.results.join).toBe("cfo,budget");
    expect(persisted.runs).toHaveLength(1);
  });
  it("retries failures and cancels from the caller", async () => {
    const persisted = store();
    let attempts = 0;
    const run = await runWorkflow(
      {
        id: "retry",
        workspaceId: "ws",
        input: {},
        budgetMs: 1000,
        steps: [
          {
            id: "x",
            agentId: "cfo",
            maxAttempts: 2,
            run: async () => {
              attempts++;
              if (attempts === 1) throw new Error("transient");
              return true;
            },
          },
        ],
      },
      { store: persisted },
    );
    expect(run.status).toBe("completed");
    expect(attempts).toBe(2);
    const controller = new AbortController();
    controller.abort();
    const cancelled = await runWorkflow(
      {
        id: "cancel",
        workspaceId: "ws",
        input: {},
        budgetMs: 1000,
        steps: [{ id: "x", agentId: "cfo", run: async () => true }],
      },
      { store: persisted, signal: controller.signal },
    );
    expect(cancelled.status).toBe("cancelled");
  });

  it("persists approval pauses and resumes without replaying completed work", async () => {
    const persisted = store();
    let preparationRuns = 0;
    let effectRuns = 0;
    let decision: "pending" | "approved" = "pending";
    const definition = createWorkflow({
      id: "approval-flow",
      workspaceId: "ws",
      input: {},
      budgetMs: 1000,
      steps: [
        {
          id: "prepare",
          agentId: "controller",
          run: async () => {
            preparationRuns++;
            return { ready: true };
          },
        },
        {
          id: "approve",
          kind: "approval",
          agentId: "human:finance",
          dependsOn: ["prepare"],
          approval: {
            approvalId: "approval_1",
            capability: "erp:write",
            summary: "Approve payable export",
          },
        },
        {
          id: "effect",
          agentId: "controller",
          dependsOn: ["approve"],
          run: async () => {
            effectRuns++;
            return { exported: true };
          },
        },
      ],
    });

    const paused = await runWorkflow(definition, {
      store: persisted,
      runId: "run_approval",
      resolveApproval: async () => decision,
    });
    expect(paused.status).toBe("paused");
    expect(preparationRuns).toBe(1);
    expect(effectRuns).toBe(0);
    expect(paused.events.at(-1)?.type).toBe("approval.requested");

    decision = "approved";
    const resumed = await resumeWorkflow(definition, {
      store: persisted,
      runId: paused.runId,
      resolveApproval: async () => decision,
    });
    expect(resumed.status).toBe("completed");
    expect(preparationRuns).toBe(1);
    expect(effectRuns).toBe(1);
    expect(resumed.events.map((event) => event.type)).toContain(
      "workflow.resumed",
    );
    expect(resumed.events.map((event) => event.type)).toContain(
      "approval.approved",
    );
  });

  it("persists terminal failure evidence before surfacing the error", async () => {
    const persisted = store();
    await expect(
      runWorkflow(
        {
          id: "failure",
          workspaceId: "ws",
          input: {},
          budgetMs: 1000,
          steps: [
            {
              id: "fail",
              agentId: "controller",
              run: async () => {
                throw new Error("provider failed");
              },
            },
          ],
        },
        { store: persisted, runId: "run_failure" },
      ),
    ).rejects.toThrow("provider failed");
    expect(persisted.runs.at(-1)?.status).toBe("failed");
    expect(persisted.events).toContainEqual(
      expect.objectContaining({ type: "workflow.failed" }),
    );
  });

  it("rejects dependency cycles before creating a persisted run", () => {
    expect(() =>
      createWorkflow({
        id: "cycle",
        workspaceId: "ws",
        input: {},
        budgetMs: 1000,
        steps: [
          {
            id: "a",
            agentId: "a",
            dependsOn: ["b"],
            run: async () => true,
          },
          {
            id: "b",
            agentId: "b",
            dependsOn: ["a"],
            run: async () => true,
          },
        ],
      }),
    ).toThrow("dependency cycle");
  });

  it("interrupts a non-cooperative task at its step budget", async () => {
    const persisted = store();
    await expect(
      runWorkflow(
        {
          id: "timeout",
          workspaceId: "ws",
          input: {},
          budgetMs: 1000,
          steps: [
            {
              id: "hung",
              agentId: "provider",
              budgetMs: 20,
              run: () => new Promise(() => undefined),
            },
          ],
        },
        { store: persisted, runId: "run_timeout" },
      ),
    ).rejects.toThrow("timed out");
    expect(persisted.runs.at(-1)?.status).toBe("failed");
  });

  it("interrupts non-cooperative work when the caller aborts", async () => {
    const persisted = store();
    const controller = new AbortController();
    setTimeout(() => controller.abort(new Error("caller stopped")), 10);
    await expect(
      runWorkflow(
        {
          id: "abort-hung",
          workspaceId: "ws",
          input: {},
          budgetMs: 1000,
          steps: [
            {
              id: "hung",
              agentId: "provider",
              run: () => new Promise(() => undefined),
            },
          ],
        },
        {
          store: persisted,
          runId: "run_abort_hung",
          signal: controller.signal,
        },
      ),
    ).rejects.toThrow("caller stopped");
    expect(persisted.runs.at(-1)?.status).toBe("cancelled");
  });
});
