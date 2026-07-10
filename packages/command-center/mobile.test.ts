import { describe, expect, it } from "bun:test";
import { buildExpoWorkflowInbox, type CommandCenterInput } from "./index";

const input: CommandCenterInput = {
  workspaceId: "ws_1",
  workflowId: "workflow_1",
  runId: "run_1",
  nodes: [{ id: "node_1", agentId: "cfo", status: "running", label: "CFO" }],
  edges: [],
  harness: { harnessId: "hermes", workspaceId: "ws_1", teamId: "team_1", userId: "user_1", sessionId: "session_1", connectionState: "connected", capabilities: [] },
  approvals: [{ id: "approval_1", agentId: "cfo", capability: "wallet_transfer", summary: "Send USDC", status: "pending" }],
  traces: [
    { id: "trace_1", workspaceId: "ws_1", runId: "run_1", type: "workflow.started", summary: "started", at: 100 },
    { id: "trace_2", workspaceId: "ws_1", runId: "run_1", type: "approval.requested", summary: "approval requested", at: 200 },
  ],
  entityGraph: { nodes: 4, edges: 5, watermark: "graph_1" },
  savedQueries: [],
};

describe("Expo workflow inbox contract", () => {
  it("builds mobile status cards, approval actions, notifications, and deep links", () => {
    const inbox = buildExpoWorkflowInbox(input);
    expect(inbox.conversationContext).toEqual({ teamId: "team_1", harnessId: "hermes", entityWatermark: "graph_1" });
    expect(inbox.cards[0]?.status).toBe("blocked");
    expect(inbox.cards[0]?.pendingApprovals).toBe(1);
    expect(inbox.approvals[0]?.actions).toEqual(["approve", "reject", "edit"]);
    expect(inbox.cards[0]?.deepLinks.map(link => link.kind)).toContain("workflow");
    expect(inbox.notifications[0]?.status).toBe("blocked");
  });

  it("marks workflows completed without client-side orchestration", () => {
    const inbox = buildExpoWorkflowInbox({ ...input, nodes: [{ id: "node_1", agentId: "cfo", status: "completed", label: "CFO" }], approvals: [] });
    expect(inbox.cards[0]?.status).toBe("completed");
    expect(inbox.approvals).toHaveLength(0);
  });
});
