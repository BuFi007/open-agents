import { createPlan } from "../plan";
import type { AgentWorkflowInput, FilesystemAgentWorkflow } from "../types";

export const workflow = {
  id: "eve-wallet-intent-v1",
  plan: (input: AgentWorkflowInput) =>
    createPlan("eve-wallet-intent-v1", [{ id: "policy", capability: "approval.request" }, { id: "intent", capability: "agent-wallet.write-intent" }], input),
} satisfies FilesystemAgentWorkflow;
