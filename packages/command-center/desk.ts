import type { WorkspaceHarness } from "@open-agents/harness-runner";
import type { TraceEvent } from "@open-agents/traces";

export type WorkflowNode = { id: string; agentId: string; status: "pending" | "running" | "completed" | "failed" | "cancelled"; label: string };
export type WorkflowEdge = { from: string; to: string };
export type AgentCard = { agentId: string; label: string; status: WorkflowNode["status"]; activeTool?: string; budgetRemainingMs?: number };
export type ApprovalItem = { id: string; agentId: string; capability: string; summary: string; status: "pending" | "approved" | "rejected" };
export type OperationConsoleLine = { id: string; atMs: number; kind: "intent" | "tool" | "workflow" | "trace"; label: string; status: "info" | "success" | "warning" | "error" };

export type CommandCenterInput = {
  workspaceId: string;
  workflowId: string;
  runId: string;
  nodes: readonly WorkflowNode[];
  edges: readonly WorkflowEdge[];
  harness: WorkspaceHarness;
  traces: readonly TraceEvent[];
  approvals: readonly ApprovalItem[];
  entityGraph: { nodes: number; edges: number; watermark: string };
  savedQueries: readonly { id: string; label: string }[];
};

export type DeskCommandCenter = {
  workflow: { id: string; runId: string; nodes: readonly WorkflowNode[]; edges: readonly WorkflowEdge[] };
  agentCards: readonly AgentCard[];
  harness: Pick<WorkspaceHarness, "harnessId" | "connectionState" | "sandboxRef" | "capabilities">;
  approvals: readonly ApprovalItem[];
  entityGraph: CommandCenterInput["entityGraph"];
  traceDrawer: readonly TraceEvent[];
  console: readonly OperationConsoleLine[];
  widgets: readonly { id: string; kind: "entity-graph" | "workflow" | "agent-roster" | "saved-query"; label: string }[];
};

const ID = /^[a-zA-Z0-9][a-zA-Z0-9:_./-]{1,191}$/;

function requireId(name: string, value: string): void {
  if (!ID.test(value)) throw new Error(`invalid command center ${name}`);
}

function traceToConsole(event: TraceEvent): OperationConsoleLine {
  const status = event.type.endsWith("completed") ? "success" : event.type.endsWith("blocked") || event.type.endsWith("cancelled") ? "warning" : event.type.includes("failed") ? "error" : "info";
  const kind = event.type.startsWith("tool.") ? "tool" : event.type.startsWith("workflow.") ? "workflow" : "trace";
  return { id: event.id, atMs: event.at, kind, label: event.summary ?? event.type, status };
}

export function buildDeskCommandCenter(input: CommandCenterInput): DeskCommandCenter {
  requireId("workspaceId", input.workspaceId);
  requireId("workflowId", input.workflowId);
  requireId("runId", input.runId);
  const nodeIds = new Set<string>();
  for (const node of input.nodes) {
    requireId("nodeId", node.id);
    requireId("agentId", node.agentId);
    if (nodeIds.has(node.id)) throw new Error(`duplicate workflow node: ${node.id}`);
    nodeIds.add(node.id);
  }
  for (const edge of input.edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) throw new Error("workflow edge references unknown node");
  }
  const agentCards = input.nodes.map(node => ({ agentId: node.agentId, label: node.label, status: node.status }));
  const consoleLines = input.traces.map(traceToConsole).sort((a, b) => a.atMs - b.atMs);
  return {
    workflow: { id: input.workflowId, runId: input.runId, nodes: [...input.nodes], edges: [...input.edges] },
    agentCards,
    harness: { harnessId: input.harness.harnessId, connectionState: input.harness.connectionState, sandboxRef: input.harness.sandboxRef, capabilities: input.harness.capabilities },
    approvals: [...input.approvals],
    entityGraph: { ...input.entityGraph },
    traceDrawer: [...input.traces],
    console: consoleLines,
    widgets: [
      { id: "workflow", kind: "workflow", label: "Workflow" },
      { id: "agents", kind: "agent-roster", label: "Agents" },
      { id: "entity_graph", kind: "entity-graph", label: "Entity Graph" },
      ...input.savedQueries.map(query => ({ id: query.id, kind: "saved-query" as const, label: query.label })),
    ],
  };
}
