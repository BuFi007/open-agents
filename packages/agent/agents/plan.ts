import type { AgentWorkflowInput, AgentWorkflowPlan, AgentWorkflowStep } from "./types";

export function createPlan(
  workflowId: string,
  steps: readonly Omit<AgentWorkflowStep, "dependsOn">[],
  input: AgentWorkflowInput,
): AgentWorkflowPlan {
  if (input.goal.trim().length === 0) {
    throw new Error("Agent workflow goal cannot be empty.");
  }
  if (input.workspaceId.trim().length === 0) {
    throw new Error("Agent workflow workspaceId cannot be empty.");
  }

  const seen = new Set<string>();
  return {
    workflowId,
    steps: steps.map((step, index) => {
      if (seen.has(step.id)) throw new Error(`Duplicate workflow step: ${step.id}`);
      seen.add(step.id);
      return {
        ...step,
        dependsOn: index === 0 ? [] : [steps[index - 1]!.id],
      };
    }),
  };
}
