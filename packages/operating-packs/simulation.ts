import { createHash } from "node:crypto";
import type { ContextPacket } from "@open-agents/knowledge";
import type { BusinessArchitectureGraph } from "./business-graph";
import type { OperatingPackManifest } from "./manifest";

export type SimulationResult = {
  mode: "dry-run";
  workflowId: string;
  graphWatermark: string;
  contextPacketHash: string;
  manifestVersion: string;
  proposedChanges: readonly {
    targetId: string;
    operation: "create" | "update";
    summary: string;
  }[];
  requiredApprovals: readonly string[];
  missingEvidence: readonly string[];
  estimatedToolCalls: number;
  estimatedBudgetUsd: number;
  risk: "low" | "medium" | "high";
  externalEffectsExecuted: 0;
  simulationHash: string;
};

export function simulatePackWorkflow(input: {
  graph: BusinessArchitectureGraph;
  contextPacket: ContextPacket;
  manifest: OperatingPackManifest;
  workflowId: string;
  connectorFreshness: Readonly<Record<string, "current" | "stale" | "missing">>;
}): SimulationResult {
  const workflow = input.manifest.workflows.find(
    (candidate) => candidate.id === input.workflowId,
  );
  if (!workflow) throw new Error(`unknown pack workflow: ${input.workflowId}`);
  if (input.contextPacket.workspaceId !== input.graph.workspaceId)
    throw new Error("simulation workspace mismatch");
  const stale = Object.entries(input.connectorFreshness)
    .filter(([, state]) => state !== "current")
    .map(([connector, state]) => `${connector}:${state}`);
  if (stale.some((item) => item.endsWith(":stale")))
    throw new Error(
      `simulation source exceeds freshness SLO: ${stale.join(",")}`,
    );
  const result = {
    mode: "dry-run" as const,
    workflowId: workflow.id,
    graphWatermark: input.graph.watermark,
    contextPacketHash: input.contextPacket.packetHash,
    manifestVersion: input.manifest.version,
    proposedChanges: workflow.agentIds.map((agentId) => ({
      targetId: `workflow:${workflow.id}:${agentId}`,
      operation: "create" as const,
      summary: `Proposed output from ${agentId}`,
    })),
    requiredApprovals: workflow.requiredApproval
      ? [`workflow:${workflow.id}`]
      : [],
    missingEvidence: stale.filter((item) => item.endsWith(":missing")),
    estimatedToolCalls: Math.max(1, workflow.agentIds.length * 2),
    estimatedBudgetUsd: workflow.agentIds.length * 0.25,
    risk: workflow.risk,
    externalEffectsExecuted: 0 as const,
  };
  return {
    ...result,
    simulationHash: `sha256:${createHash("sha256").update(JSON.stringify(result)).digest("hex")}`,
  };
}

export function replayDrift(input: {
  original: SimulationResult;
  currentGraphWatermark: string;
  currentContextPacketHash: string;
}): { drifted: boolean; graphChanged: boolean; contextChanged: boolean } {
  const graphChanged =
    input.original.graphWatermark !== input.currentGraphWatermark;
  const contextChanged =
    input.original.contextPacketHash !== input.currentContextPacketHash;
  return {
    drifted: graphChanged || contextChanged,
    graphChanged,
    contextChanged,
  };
}

export function admitPackWorkflowExecution(input: {
  manifest: OperatingPackManifest;
  workflowId: string;
  simulation?: SimulationResult;
}): { admitted: boolean; reason: string } {
  const workflow = input.manifest.workflows.find(
    (candidate) => candidate.id === input.workflowId,
  );
  if (!workflow) return { admitted: false, reason: "unknown pack workflow" };
  if (
    workflow.risk === "high" &&
    (!input.simulation || input.simulation.workflowId !== workflow.id)
  )
    return {
      admitted: false,
      reason: "high-risk workflow requires a matching dry-run simulation",
    };
  if (input.simulation?.externalEffectsExecuted !== 0)
    return {
      admitted: false,
      reason: "invalid simulation executed external effects",
    };
  return { admitted: true, reason: "workflow passed simulation admission" };
}
