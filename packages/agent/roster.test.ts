import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import {
  getBufiAgent,
  listBufiAgents,
  planBufiAgentWorkflow,
} from "./roster";

const EXPECTED_IDS = ["bufi", "cfo", "budgeting", "invoicing", "payroll", "eve"];

describe("BUFI filesystem roster", () => {
  it("exposes one least-privilege definition per filesystem agent", () => {
    const agents = listBufiAgents();
    expect(agents.map(agent => agent.id)).toEqual(EXPECTED_IDS);
    expect(new Set(agents.map(agent => agent.workflow.id)).size).toBe(agents.length);
    for (const agent of agents) {
      expect(agent.tools.length).toBeGreaterThan(0);
      expect(agent.instructions.protocol).toBe("file:");
    }
  });

  it("keeps instructions next to every agent definition", async () => {
    for (const agent of listBufiAgents()) {
      const instructions = await readFile(agent.instructions, "utf8");
      expect(instructions.trim()).toContain(`# ${agent.displayName}`);
    }
  });

  it("creates validated, dependency-ordered workflow plans", () => {
    const plan = planBufiAgentWorkflow("cfo", {
      goal: "Review runway",
      workspaceId: "workspace-1",
    });
    expect(plan.workflowId).toBe("cfo-review-v1");
    expect(plan.steps[0]?.dependsOn).toEqual([]);
    expect(plan.steps[1]?.dependsOn).toEqual(["financial-review"]);
  });

  it("rejects unknown or empty workflow requests", () => {
    expect(() => getBufiAgent("missing")).not.toThrow();
    expect(() => planBufiAgentWorkflow("missing", { goal: "x", workspaceId: "w" })).toThrow(
      "Unknown BUFI agent",
    );
    expect(() => planBufiAgentWorkflow("cfo", { goal: " ", workspaceId: "w" })).toThrow(
      "goal cannot be empty",
    );
  });
});
