import { createPlan } from "../plan";
import type { AgentWorkflowInput, FilesystemAgentWorkflow } from "../types";

export const workflow = {
  id: "cfo-review-v1",
  plan: (input: AgentWorkflowInput) =>
    createPlan("cfo-review-v1", [{ id: "financial-review", capability: "financial.read" }, { id: "evidence", capability: "knowledge.read" }, { id: "approval", capability: "approval.request" }], input),
} satisfies FilesystemAgentWorkflow;
