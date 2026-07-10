import { createPlan } from "../plan";
import type { AgentWorkflowInput, FilesystemAgentWorkflow } from "../types";

export const workflow = {
  id: "invoicing-draft-v1",
  plan: (input: AgentWorkflowInput) =>
    createPlan("invoicing-draft-v1", [{ id: "accounting", capability: "accounting.read" }, { id: "evidence", capability: "knowledge.read" }, { id: "draft", capability: "invoice.draft" }], input),
} satisfies FilesystemAgentWorkflow;
