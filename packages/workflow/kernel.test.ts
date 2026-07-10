import { describe, expect, it } from "bun:test";
import { createWorkflow, runWorkflow, type WorkflowStore } from "./index";

const store = (): WorkflowStore & { events: unknown[]; runs: unknown[] } => ({ events: [], runs: [], async append(_id, event) { this.events.push(event); }, async save(run) { this.runs.push(run); } });

describe("durable workflow kernel", () => {
  it("fans out independent steps and joins dependencies", async () => {
    const seen: string[] = []; const persisted = store();
    const run = await runWorkflow(createWorkflow({ id: "plan", workspaceId: "ws", input: {}, budgetMs: 1000, steps: [
      { id: "cfo", agentId: "cfo", run: async () => { seen.push("cfo"); return 1; } },
      { id: "budget", agentId: "budgeting", run: async () => { seen.push("budget"); return 2; } },
      { id: "join", agentId: "bufi", dependsOn: ["cfo", "budget"], run: async () => seen.join(",") },
    ] }), { store: persisted });
    expect(run.status).toBe("completed"); expect(run.results.join).toBe("cfo,budget"); expect(persisted.runs).toHaveLength(1);
  });
  it("retries failures and cancels from the caller", async () => {
    const persisted = store(); let attempts = 0;
    const run = await runWorkflow({ id: "retry", workspaceId: "ws", input: {}, budgetMs: 1000, steps: [{ id: "x", agentId: "cfo", maxAttempts: 2, run: async () => { attempts++; if (attempts === 1) throw new Error("transient"); return true; } }] }, { store: persisted });
    expect(run.status).toBe("completed"); expect(attempts).toBe(2);
    const controller = new AbortController(); controller.abort();
    const cancelled = await runWorkflow({ id: "cancel", workspaceId: "ws", input: {}, budgetMs: 1000, steps: [{ id: "x", agentId: "cfo", run: async () => true }] }, { store: persisted, signal: controller.signal });
    expect(cancelled.status).toBe("cancelled");
  });
});
