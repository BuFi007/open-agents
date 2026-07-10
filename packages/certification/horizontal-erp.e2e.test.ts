import { describe, expect, it } from "bun:test";
import {
  buildPackComposerProjection,
  buildTeamCockpitProjection,
} from "@open-agents/command-center";
import { createWorkspaceHarness } from "@open-agents/harness-runner";
import { buildContextPacket } from "@open-agents/knowledge";
import {
  BUFI_INTERNAL_OPS_PACK,
  GRANT_OPS_PACK,
  KPIDefinitionSchema,
  STARTER_OPERATING_PACKS,
  buildScorecard,
  compileOperatingPacks,
  createBusinessArchitectureGraph,
  createMetricRun,
  evaluateEffectivePolicy,
  simulatePackWorkflow,
} from "@open-agents/operating-packs";
import { runWorkflow, type WorkflowStore } from "@open-agents/workflow";

describe("Horizontal AI ERP operating-pack certification", () => {
  it("installs one graph, runs cross-functional workflows, scores evidence, and remains policy-gated", async () => {
    const graph = createBusinessArchitectureGraph({
      workspaceId: "bufi_ws",
      entities: [
        {
          id: "goal_operate",
          workspaceId: "bufi_ws",
          kind: "Goal",
          name: "Operate BUFI",
          version: 1,
          fields: {},
          evidenceRefs: ["linear:goal"],
        },
        {
          id: "customer_shared",
          workspaceId: "bufi_ws",
          kind: "Customer",
          name: "Shared Customer",
          version: 1,
          fields: {},
          evidenceRefs: ["crm:customer"],
        },
      ],
    });
    const harness = createWorkspaceHarness({
      harnessId: "hermes",
      workspaceId: "bufi_ws",
      teamId: "bufi_team",
      userId: "founder",
      sessionId: "certification_1",
      connectionState: "connected",
      sandboxRef: "local-hermes",
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
          allowedOperations: ["start", "inspect"],
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
    const compiled = compileOperatingPacks({
      graph,
      harness,
      manifests: [...STARTER_OPERATING_PACKS, BUFI_INTERNAL_OPS_PACK],
    });
    expect(compiled.manifests).toHaveLength(5);
    expect(
      compiled.graph.entities.filter((entity) => entity.kind === "Customer"),
    ).toHaveLength(1);
    expect(
      compiled.workflows.some(
        (workflow) =>
          workflow.id === "customer_signal_to_revenue" && workflow.crossPack,
      ),
    ).toBe(true);

    const composer = buildPackComposerProjection({
      compiled,
      connectedConnectorIds: [
        "knowledge_graph",
        "workflow_store",
        "accounting",
        "delivery",
        "bufi_delivery",
      ],
    });
    expect(composer.installedPacks).toHaveLength(5);
    expect(
      composer.components.filter((component) => component.state === "enabled")
        .length,
    ).toBeGreaterThan(4);

    const definitions = [
      "runway",
      "revenue",
      "burn",
      "shipped_prs",
      "wallet_balances",
    ].map((id, index) =>
      KPIDefinitionSchema.parse({
        id,
        version: 1,
        name: id.replaceAll("_", " "),
        formula: `evidence_input_${index}`,
        grain: "workspace",
        ownerEntityId: "goal_operate",
        sourceKinds: [
          "source-artifact",
          "erp-effect",
          "wallet-balance",
          "workflow-trace",
        ],
        dimensions: [],
        period: "weekly",
        freshnessSloMs: 86_400_000,
        caveats: [],
        packIds: ["bufi_internal_ops"],
        goalIds: ["goal_operate"],
        teamIds: ["bufi_team"],
      }),
    );
    const runs = definitions.map((definition, index) =>
      createMetricRun({
        id: `metric_${index}`,
        definitionId: definition.id,
        definitionVersion: 1,
        value: index + 1,
        unit: "count",
        periodStartMs: 0,
        periodEndMs: 100,
        inputs: { source: index + 1 },
        evidenceHashes: [
          `sha256:source-artifact-${index}`,
          `sha256:erp-wallet-workflow-${index}`,
        ],
        traceId: `trace_metric_${index}`,
        generatedAtMs: 100,
        staleAtMs: 1000,
        confidence: 0.95,
      }),
    );
    expect(
      buildScorecard({
        definitions,
        runs,
        nowMs: 200,
        packId: "bufi_internal_ops",
      }).filter((item) => item.status === "current"),
    ).toHaveLength(5);

    const packet = buildContextPacket({
      workspaceId: "bufi_ws",
      authorizationScope: "scope_read",
      graphWatermark: compiled.graph.watermark,
      projectionWatermark: "projection_1",
      ontologyVersion: "business_graph_v1",
      query: "grant opportunity",
      intent: "grant-review",
      budgets: {
        maxReferences: 5,
        maxSnippetChars: 100,
        maxRestrictedReferences: 0,
      },
      rankFusionVersion: "rrf_1",
      embedding: { provider: "typesense", model: "hybrid", inputVersion: "v1" },
      workflowRunId: "grant_run",
      agentRunId: "grant_research",
      traceId: "trace_grant",
      generatedAtMs: 100,
      expiresAtMs: 1000,
      references: [
        {
          id: "grant_source",
          kind: "source-artifact",
          sourceId: "artifact_grant",
          observedAtMs: 90,
          confidence: 1,
          redaction: "metadata-only",
          scores: { lexical: 1, vector: 1, graph: 1, recency: 1 },
          rank: 1,
          snippet: "Grant program",
          evidenceVersion: 1,
        },
      ],
    });
    expect(
      simulatePackWorkflow({
        graph: compiled.graph,
        contextPacket: packet,
        manifest: GRANT_OPS_PACK,
        workflowId: "grant_opportunity_review",
        connectorFreshness: {
          knowledge_graph: "current",
          workflow_store: "current",
        },
      }).externalEffectsExecuted,
    ).toBe(0);

    const policy = evaluateEffectivePolicy({
      invocation: {
        targets: [
          { scope: "workspace", id: "bufi_ws" },
          { scope: "tool", id: "circle_pay_service" },
        ],
        permission: "wallet:spend",
        tool: "circle_pay_service",
        operation: "pay",
        estimatedCostUsd: 1,
        externalWrite: true,
      },
      rules: [
        {
          id: "wallet_spend",
          target: { scope: "workspace", id: "bufi_ws" },
          effect: "allow",
          permissions: ["wallet:spend"],
          approvalRequired: true,
          budgetUsd: 10,
        },
      ],
      killSwitches: [],
    });
    expect(policy).toMatchObject({ allowed: true, approvalRequired: true });

    const store: WorkflowStore = { async append() {}, async save() {} };
    for (const workflowId of [
      "weekly_scorecard",
      "pr_linear_reconciliation",
      "blocked_work_pulse",
    ]) {
      const result = await runWorkflow(
        {
          id: workflowId,
          workspaceId: "bufi_ws",
          input: { graphWatermark: compiled.graph.watermark },
          budgetMs: 10_000,
          steps: [
            {
              id: "research",
              agentId: "coo",
              async run() {
                return { evidence: packet.packetHash };
              },
            },
            {
              id: "finance",
              agentId: "cfo",
              dependsOn: ["research"],
              async run() {
                return { reviewed: true };
              },
            },
            {
              id: "decision",
              agentId: "founder",
              dependsOn: ["finance"],
              async run() {
                return { approved: true };
              },
            },
          ],
        },
        { store, runId: `${workflowId}_run` },
      );
      expect(result.status).toBe("completed");
    }

    const cockpit = buildTeamCockpitProjection({
      workflowId: "grant_opportunity_review",
      nodes: [
        {
          id: "research",
          agentId: "research",
          status: "completed",
          label: "Research",
        },
        {
          id: "finance",
          agentId: "finance",
          status: "completed",
          label: "Finance",
        },
        {
          id: "compliance",
          agentId: "compliance",
          status: "running",
          label: "Compliance",
        },
      ],
      ownership: [
        {
          nodeId: "research",
          ownerType: "agent",
          ownerId: "research",
          roleId: "grant_research",
          toolGrantIds: ["knowledge_read"],
        },
        {
          nodeId: "finance",
          ownerType: "agent",
          ownerId: "finance",
          roleId: "finance",
          toolGrantIds: ["knowledge_read"],
        },
        {
          nodeId: "compliance",
          ownerType: "human",
          ownerId: "founder",
          roleId: "approver",
          toolGrantIds: [],
        },
      ],
      blockers: [
        {
          id: "missing_form",
          nodeId: "compliance",
          kind: "missing-evidence",
          summary: "Submission form missing",
          evidenceRefs: ["grant_source"],
        },
      ],
      approvals: [
        {
          id: "founder_approval",
          agentId: "compliance",
          capability: "workflow_continue",
          summary: "Approve submission",
          status: "pending",
        },
      ],
      traces: [
        {
          id: "trace_approval",
          workspaceId: "bufi_ws",
          runId: "grant_run",
          type: "approval.requested",
          at: 200,
        },
      ],
      groupBy: { goalId: "goal_operate", packId: "grant_ops" },
    });
    expect(cockpit.ownership).toHaveLength(3);
    expect(cockpit.approvals[0]?.actions).toContain("ask-for-evidence");
  });
});
