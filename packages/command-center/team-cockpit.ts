import type { TraceEvent } from "@open-agents/traces";
import type { ApprovalItem, WorkflowNode } from "./desk";

export type WorkflowOwnership = {
  nodeId: string;
  ownerType: "human" | "agent";
  ownerId: string;
  roleId: string;
  toolGrantIds: readonly string[];
};
export type WorkflowBlocker = {
  id: string;
  nodeId?: string;
  kind:
    | "missing-connector"
    | "missing-evidence"
    | "pending-approval"
    | "failed-job"
    | "stale-graph"
    | "budget-exceeded"
    | "degraded-harness";
  summary: string;
  evidenceRefs: readonly string[];
};
export type TeamCockpitProjection = {
  workflowId: string;
  groupBy: {
    goalId?: string;
    teamId?: string;
    projectId?: string;
    entityId?: string;
    packId?: string;
  };
  ownership: readonly WorkflowOwnership[];
  blockers: readonly WorkflowBlocker[];
  approvals: readonly (ApprovalItem & {
    actions: readonly ("approve" | "reject" | "edit" | "ask-for-evidence")[];
  })[];
  traces: readonly TraceEvent[];
  asyncSummary: string;
};

export function buildTeamCockpitProjection(input: {
  workflowId: string;
  nodes: readonly WorkflowNode[];
  ownership: readonly WorkflowOwnership[];
  blockers: readonly WorkflowBlocker[];
  approvals: readonly ApprovalItem[];
  traces: readonly TraceEvent[];
  groupBy: TeamCockpitProjection["groupBy"];
}): TeamCockpitProjection {
  const nodeIds = new Set(input.nodes.map((node) => node.id));
  if (input.ownership.some((owner) => !nodeIds.has(owner.nodeId)))
    throw new Error("workflow ownership references unknown node");
  if (
    new Set(input.ownership.map((owner) => owner.nodeId)).size !==
    input.nodes.length
  )
    throw new Error("every workflow node requires explicit ownership");
  const pending = input.approvals.filter(
    (approval) => approval.status === "pending",
  );
  const failed = input.nodes.filter((node) => node.status === "failed").length;
  const blockers = [
    ...input.blockers,
    ...pending.map((approval) => ({
      id: `approval:${approval.id}`,
      kind: "pending-approval" as const,
      summary: approval.summary,
      evidenceRefs: [],
    })),
    ...input.nodes
      .filter((node) => node.status === "failed")
      .map((node) => ({
        id: `failed:${node.id}`,
        nodeId: node.id,
        kind: "failed-job" as const,
        summary: `${node.label} failed`,
        evidenceRefs: [],
      })),
  ];
  return {
    workflowId: input.workflowId,
    groupBy: input.groupBy,
    ownership: [...input.ownership],
    blockers,
    approvals: input.approvals.map((approval) => ({
      ...approval,
      actions: ["approve", "reject", "edit", "ask-for-evidence"],
    })),
    traces: [...input.traces],
    asyncSummary: `${input.nodes.length} nodes · ${pending.length} approvals · ${blockers.length} blockers · ${failed} failed`,
  };
}
