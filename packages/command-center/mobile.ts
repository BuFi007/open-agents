import type { CommandCenterInput } from "./desk";
import { buildDeskCommandCenter } from "./desk";

export type ExpoApprovalAction = {
  approvalId: string;
  actions: readonly ("approve" | "reject" | "edit")[];
  deepLink: string;
};

export type ExpoWorkflowStatusCard = {
  workflowId: string;
  runId: string;
  title: string;
  status: "active" | "blocked" | "completed" | "failed";
  summary: string;
  pendingApprovals: number;
  traceSummary: readonly string[];
  deepLinks: readonly {
    kind: "workflow" | "agent" | "entity" | "wallet-intent";
    targetId: string;
    href: string;
  }[];
};

export type ExpoWorkflowInbox = {
  workspaceId: string;
  conversationContext: {
    teamId: string;
    harnessId: string;
    entityWatermark: string;
  };
  cards: readonly ExpoWorkflowStatusCard[];
  approvals: readonly ExpoApprovalAction[];
  notifications: readonly {
    id: string;
    title: string;
    status: ExpoWorkflowStatusCard["status"];
  }[];
  agentWallet: {
    availableTools: number;
    approvalRequired: number;
    workflowSteps: number;
  };
};

function href(kind: string, targetId: string): string {
  return `bufi://${kind}/${encodeURIComponent(targetId)}`;
}

export function buildExpoWorkflowInbox(
  input: CommandCenterInput,
): ExpoWorkflowInbox {
  const desk = buildDeskCommandCenter(input);
  const hasFailure = desk.workflow.nodes.some(
    (node) => node.status === "failed",
  );
  const active = desk.workflow.nodes.some(
    (node) => node.status === "running" || node.status === "pending",
  );
  const pendingApprovals = desk.approvals.filter(
    (approval) => approval.status === "pending",
  );
  const status = hasFailure
    ? "failed"
    : pendingApprovals.length
      ? "blocked"
      : active
        ? "active"
        : "completed";
  const traceSummary = desk.console.slice(-3).map((line) => line.label);
  const card: ExpoWorkflowStatusCard = {
    workflowId: desk.workflow.id,
    runId: desk.workflow.runId,
    title: desk.workflow.nodes.map((node) => node.label).join(" + "),
    status,
    summary: pendingApprovals.length
      ? `${pendingApprovals.length} approval pending`
      : (traceSummary.at(-1) ?? "No activity yet"),
    pendingApprovals: pendingApprovals.length,
    traceSummary,
    deepLinks: [
      {
        kind: "workflow",
        targetId: desk.workflow.runId,
        href: href("workflow", desk.workflow.runId),
      },
      ...desk.agentCards.map((card) => ({
        kind: "agent" as const,
        targetId: card.agentId,
        href: href("agent", card.agentId),
      })),
      {
        kind: "entity",
        targetId: desk.entityGraph.watermark,
        href: href("entity-graph", desk.entityGraph.watermark),
      },
      ...pendingApprovals
        .filter((approval) =>
          desk.agentWallet.tools.some(
            (tool) => tool.name === approval.capability,
          ),
        )
        .map((approval) => ({
          kind: "wallet-intent" as const,
          targetId: approval.id,
          href: href("wallet-intent", approval.id),
        })),
    ],
  };
  return {
    workspaceId: input.workspaceId,
    conversationContext: {
      teamId: input.harness.teamId,
      harnessId: input.harness.harnessId,
      entityWatermark: input.entityGraph.watermark,
    },
    cards: [card],
    approvals: pendingApprovals.map((approval) => ({
      approvalId: approval.id,
      actions: ["approve", "reject", "edit"],
      deepLink: href("approval", approval.id),
    })),
    notifications: [
      { id: `${desk.workflow.runId}:${status}`, title: card.summary, status },
    ],
    agentWallet: {
      availableTools: desk.agentWallet.tools.filter((tool) => tool.available)
        .length,
      approvalRequired: desk.agentWallet.tools.filter(
        (tool) => tool.status === "approval-required",
      ).length,
      workflowSteps: desk.agentWallet.workflow.length,
    },
  };
}
