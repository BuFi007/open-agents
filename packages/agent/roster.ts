import { budgetingAgent } from "./agents/budgeting/agent";
import { bufiAgent } from "./agents/bufi/agent";
import { cfoAgent } from "./agents/cfo/agent";
import { eveAgent } from "./agents/eve/agent";
import { invoicingAgent } from "./agents/invoicing/agent";
import { payrollAgent } from "./agents/payroll/agent";
import type { FilesystemAgentDefinition } from "./agents/types";

/**
 * Filesystem-first BUFI roster. Each definition lives beside its instructions,
 * capability bundle, and workflow so adapters can mount the same roster into
 * Open Agents, Eve, or a future durable workflow runtime.
 */
export const BUFI_AGENT_ROSTER = [
  bufiAgent,
  cfoAgent,
  budgetingAgent,
  invoicingAgent,
  payrollAgent,
  eveAgent,
] as const satisfies readonly FilesystemAgentDefinition[];

const rosterById = new Map(BUFI_AGENT_ROSTER.map(agent => [agent.id, agent]));

export function listBufiAgents(): readonly FilesystemAgentDefinition[] {
  return BUFI_AGENT_ROSTER;
}

export function getBufiAgent(id: string): FilesystemAgentDefinition | undefined {
  return rosterById.get(id);
}

export function planBufiAgentWorkflow(
  id: string,
  input: Parameters<FilesystemAgentDefinition["workflow"]["plan"]>[0],
) {
  const agent = getBufiAgent(id);
  if (!agent) throw new Error(`Unknown BUFI agent: ${id}`);
  return agent.workflow.plan(input);
}
