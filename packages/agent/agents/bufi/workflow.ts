import { createPlan } from "../plan";
import type { AgentWorkflowInput, FilesystemAgentWorkflow } from "../types";

export const workflow = {
  id: "bufi-coordination-v1",
  plan: (input: AgentWorkflowInput) =>
    createPlan(
      "bufi-coordination-v1",
      [
        { id: "context", capability: "knowledge.read" },
        { id: "delegate", capability: "workflow.delegate" },
        { id: "synthesize", capability: "workflow.synthesize" },
      ],
      input,
    ),
} satisfies FilesystemAgentWorkflow;
