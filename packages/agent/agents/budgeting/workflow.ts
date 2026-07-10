import { createPlan } from "../plan";
import type { AgentWorkflowInput, FilesystemAgentWorkflow } from "../types";

export const workflow = {
  id: "budgeting-forecast-v1",
  plan: (input: AgentWorkflowInput) =>
    createPlan("budgeting-forecast-v1", [{ id: "financials", capability: "financial.read" }, { id: "forecast", capability: "forecast.read" }, { id: "evidence", capability: "knowledge.read" }], input),
} satisfies FilesystemAgentWorkflow;
