import { describe, expect, it } from "bun:test";
import { createWorkspaceHarness } from "@open-agents/harness-runner";
import {
  FINANCE_OPS_PACK,
  GRANT_OPS_PACK,
  compileOperatingPacks,
  createBusinessArchitectureGraph,
} from "@open-agents/operating-packs";
import {
  buildPackComposerProjection,
  buildTeamCockpitProjection,
} from "./index";

const harness = createWorkspaceHarness({
  harnessId: "hermes",
  workspaceId: "ws_1",
  teamId: "team_1",
  userId: "user_1",
  sessionId: "session_1",
  connectionState: "connected",
  capabilities: [
    {
      name: "knowledge_read",
      server: "custom",
      scopes: ["knowledge.read"],
      requiresApproval: false,
      allowedOperations: ["query"],
    },
    {
      name: "workflow_run",
      server: "custom",
      scopes: ["workflow.run"],
      requiresApproval: false,
      allowedOperations: ["start"],
    },
    {
      name: "circle_get_balance",
      server: "bufi-hyper",
      scopes: ["wallet.read"],
      requiresApproval: false,
      allowedOperations: ["read"],
    },
  ],
});

describe("Operating pack command-center projections", () => {
  it("projects two packs onto a reversible evidence-aware composer", () => {
    const compiled = compileOperatingPacks({
      graph: createBusinessArchitectureGraph({ workspaceId: "ws_1" }),
      harness,
      manifests: [FINANCE_OPS_PACK, GRANT_OPS_PACK],
    });
    const projection = buildPackComposerProjection({
      compiled,
      connectedConnectorIds: ["knowledge_graph", "workflow_store"],
      disabledComponentIds: ["grant_pipeline"],
    });
    expect(projection.installedPacks).toHaveLength(2);
    expect(
      projection.components.find(
        (component) => component.id === "finance_scorecard",
      )?.state,
    ).toBe("blocked");
    expect(
      projection.components.find(
        (component) => component.id === "grant_pipeline",
      )?.state,
    ).toBe("disabled");
    expect(
      projection.components.every((component) => component.evidenceRequired),
    ).toBe(true);
    expect(projection.reversible).toBe(true);
  });

  it("makes three-agent ownership, blockers, approvals, and evidence explicit", () => {
    const nodes = [
      {
        id: "research",
        agentId: "research",
        status: "completed" as const,
        label: "Research",
      },
      {
        id: "finance",
        agentId: "finance",
        status: "completed" as const,
        label: "Finance",
      },
      {
        id: "compliance",
        agentId: "compliance",
        status: "running" as const,
        label: "Compliance",
      },
    ];
    const cockpit = buildTeamCockpitProjection({
      workflowId: "grant_review",
      nodes,
      ownership: nodes.map((node) => ({
        nodeId: node.id,
        ownerType: "agent" as const,
        ownerId: node.agentId,
        roleId: node.agentId,
        toolGrantIds: ["knowledge_read"],
      })),
      blockers: [
        {
          id: "evidence_1",
          nodeId: "compliance",
          kind: "missing-evidence",
          summary: "Eligibility certificate missing",
          evidenceRefs: ["source_1"],
        },
      ],
      approvals: [
        {
          id: "approval_1",
          agentId: "compliance",
          capability: "workflow_continue",
          summary: "Founder decision",
          status: "pending",
        },
      ],
      traces: [
        {
          id: "trace_1",
          workspaceId: "ws_1",
          runId: "grant_review",
          type: "approval.requested",
          summary: "Founder decision",
          at: 100,
        },
      ],
      groupBy: { goalId: "goal_growth", packId: "grant_ops" },
    });
    expect(cockpit.ownership).toHaveLength(3);
    expect(cockpit.blockers).toHaveLength(2);
    expect(cockpit.approvals[0]?.actions).toContain("ask-for-evidence");
    expect(cockpit.asyncSummary).toContain("1 approvals");
  });
});
