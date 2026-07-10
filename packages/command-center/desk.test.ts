import { describe, expect, it } from "bun:test";
import { buildDeskCommandCenter } from "./index";

describe("Desk command center contract", () => {
  it("builds a developer control plane over workflow, harness, approvals, traces, and widgets", () => {
    const view = buildDeskCommandCenter({
      workspaceId: "ws_1",
      workflowId: "workflow_1",
      runId: "run_1",
      nodes: [
        { id: "node_1", agentId: "cfo", status: "completed", label: "CFO" },
        { id: "node_2", agentId: "payroll", status: "running", label: "Payroll" },
      ],
      edges: [{ from: "node_1", to: "node_2" }],
      harness: {
        harnessId: "hermes",
        workspaceId: "ws_1",
        teamId: "team_1",
        userId: "user_1",
        sessionId: "session_1",
        connectionState: "connected",
        capabilities: [{ name: "defi_quote", server: "bufi-hyper", scopes: ["defi.read"], requiresApproval: false, allowedOperations: ["quote"] }],
      },
      approvals: [{ id: "approval_1", agentId: "payroll", capability: "wallet_transfer", summary: "Pay contractor", status: "pending" }],
      traces: [
        { id: "trace_2", workspaceId: "ws_1", runId: "run_1", type: "tool.called", toolName: "wallet", summary: "wallet quote", at: 200 },
        { id: "trace_1", workspaceId: "ws_1", runId: "run_1", type: "workflow.started", summary: "started", at: 100 },
      ],
      entityGraph: { nodes: 10, edges: 12, watermark: "graph_1" },
      savedQueries: [{ id: "query_1", label: "Open invoices" }],
    });
    expect(view.workflow.edges).toHaveLength(1);
    expect(view.agentCards.map(card => card.agentId)).toEqual(["cfo", "payroll"]);
    expect(view.approvals[0]?.status).toBe("pending");
    expect(view.console.map(line => line.id)).toEqual(["trace_1", "trace_2"]);
    expect(view.widgets.map(widget => widget.kind)).toContain("saved-query");
  });

  it("rejects malformed workflow edges", () => {
    expect(() => buildDeskCommandCenter({
      workspaceId: "ws_1",
      workflowId: "workflow_1",
      runId: "run_1",
      nodes: [{ id: "node_1", agentId: "cfo", status: "completed", label: "CFO" }],
      edges: [{ from: "node_1", to: "missing" }],
      harness: { harnessId: "codex", workspaceId: "ws_1", teamId: "team_1", userId: "user_1", sessionId: "session_1", connectionState: "connected", capabilities: [] },
      approvals: [],
      traces: [],
      entityGraph: { nodes: 0, edges: 0, watermark: "graph_1" },
      savedQueries: [],
    })).toThrow("unknown node");
  });
});
