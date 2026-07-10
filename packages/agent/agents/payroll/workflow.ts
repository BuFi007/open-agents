import { createPlan } from "../plan";
import type { AgentWorkflowInput, FilesystemAgentWorkflow } from "../types";

export const workflow = {
  id: "payroll-packet-v1",
  plan: (input: AgentWorkflowInput) =>
    createPlan("payroll-packet-v1", [{ id: "payroll", capability: "payroll.read" }, { id: "packet", capability: "payroll.prepare" }, { id: "approval", capability: "approval.request" }], input),
} satisfies FilesystemAgentWorkflow;
