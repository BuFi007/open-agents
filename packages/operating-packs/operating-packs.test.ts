import { describe, expect, it } from "bun:test";
import { createWorkspaceHarness } from "@open-agents/harness-runner";
import { buildContextPacket } from "@open-agents/knowledge";
import {
  BUFI_INTERNAL_OPS_PACK,
  BUSINESS_ENTITY_KINDS,
  FINANCE_OPS_PACK,
  FUTURE_TAX_PACK_REFERENCE,
  GRANT_OPS_PACK,
  KPIDefinitionSchema,
  PRODUCT_OPS_PACK,
  SALES_OPS_PACK,
  STARTER_OPERATING_PACKS,
  TAX_AUTOMATION_PACK,
  buildScorecard,
  admitPackWorkflowExecution,
  compileOperatingPacks,
  compileFilesystemRoster,
  createBusinessArchitectureGraph,
  createMetricRun,
  evaluateEffectivePolicy,
  parseOperatingPackManifest,
  materializeFilesystemRoster,
  removeOperatingPack,
  replayDrift,
  resolveSharedEntity,
  reviewPackChange,
  rollbackOperatingPack,
  simulatePackWorkflow,
} from "./index";

const graph = createBusinessArchitectureGraph({
  workspaceId: "ws_1",
  entities: [
    {
      id: "goal_growth",
      workspaceId: "ws_1",
      kind: "Goal",
      name: "Sustainable growth",
      version: 1,
      fields: {},
      evidenceRefs: ["evidence_goal"],
    },
    {
      id: "customer_acme",
      workspaceId: "ws_1",
      kind: "Customer",
      name: "Acme",
      version: 1,
      fields: {},
      evidenceRefs: ["evidence_customer"],
    },
  ],
  relations: [],
});

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

describe("Horizontal AI ERP operating packs", () => {
  it("shares reserved business primitives while allowing namespaced extensions", () => {
    expect(BUSINESS_ENTITY_KINDS).toContain("Policy");
    expect(resolveSharedEntity(graph, "Goal", "goal_growth").name).toBe(
      "Sustainable growth",
    );
    expect(resolveSharedEntity(graph, "Customer", "customer_acme").id).toBe(
      "customer_acme",
    );
    expect(() =>
      createBusinessArchitectureGraph({
        workspaceId: "ws_1",
        extensions: { finance: ["workspaceId"] },
      }),
    ).toThrow("reserved");
  });

  it("validates and compiles four vertical packs onto one graph", () => {
    expect(STARTER_OPERATING_PACKS).toHaveLength(4);
    const compiled = compileOperatingPacks({
      graph,
      harness,
      manifests: STARTER_OPERATING_PACKS,
    });
    expect(compiled.graph.entities).toHaveLength(2);
    expect(
      compiled.graph.entities.filter((entity) => entity.kind === "Customer"),
    ).toHaveLength(1);
    expect(compiled.manifests).toHaveLength(4);
    expect(compiled.workflows.some((workflow) => workflow.crossPack)).toBe(
      true,
    );
    expect(compiled.deskWidgets.every((widget) => Boolean(widget.packId))).toBe(
      true,
    );
    expect(compiled.expoCards.every((card) => Boolean(card.packId))).toBe(true);
    expect(FUTURE_TAX_PACK_REFERENCE.taxImplementation).toBe(
      "external-engine-v1",
    );
  });

  it("compiles the tax pack only when the external engine capabilities are explicit", () => {
    const taxHarness = createWorkspaceHarness({
      ...harness,
      capabilities: [
        ...harness.capabilities,
        {
          name: "tax_invoice_prepare",
          server: "custom",
          scopes: ["tax.prepare"],
          requiresApproval: false,
          allowedOperations: ["prepare"],
        },
        {
          name: "tax_invoice_case_read",
          server: "custom",
          scopes: ["tax.read"],
          requiresApproval: false,
          allowedOperations: ["read"],
        },
      ],
    });
    const compiled = compileOperatingPacks({
      graph,
      harness: taxHarness,
      manifests: [FINANCE_OPS_PACK, TAX_AUTOMATION_PACK],
    });
    expect(compiled.manifests.map((manifest) => manifest.id)).toEqual([
      "finance_ops",
      "tax_automation",
    ]);
    expect(compiled.workflows).toContainEqual(
      expect.objectContaining({ id: "ai_invoice_to_factura_e", risk: "high" }),
    );
    expect(() =>
      compileOperatingPacks({
        graph,
        harness,
        manifests: [FINANCE_OPS_PACK, TAX_AUTOMATION_PACK],
      }),
    ).toThrow("undeclared harness capability");
  });

  it("compiles every installed role into an Eve-style filesystem roster", () => {
    const compiled = compileOperatingPacks({
      graph,
      harness,
      manifests: STARTER_OPERATING_PACKS,
    });
    const roster = compileFilesystemRoster(compiled);
    expect(roster).toHaveLength(compiled.agents.length);
    for (const agent of roster) {
      expect(agent.root).toBe(`agents/${agent.packId}/${agent.agentId}`);
      expect(agent.files.map((file) => file.path)).toContain("agent.ts");
      expect(agent.files.map((file) => file.path)).toContain("instructions.md");
      expect(agent.files.map((file) => file.path)).toContain("tools/index.ts");
      expect(
        agent.files.some((file) => file.path.startsWith("workflows/")),
      ).toBe(true);
    }
    const cfo = roster.find(
      (agent) => agent.packId === "finance_ops" && agent.agentId === "cfo",
    );
    expect(cfo?.workflowIds).toContain("weekly_finance_review");
    expect(cfo?.workflowIds).toContain("customer_signal_to_revenue");
    expect(
      cfo?.files.find((file) => file.path === "agent.ts")?.content,
    ).toContain("defineFilesystemAgent");
  });

  it("materializes the compiled roster inside a sandbox-safe root", async () => {
    const compiled = compileOperatingPacks({
      graph,
      harness,
      manifests: STARTER_OPERATING_PACKS,
    });
    const files = new Map<string, string>();
    const written = await materializeFilesystemRoster({
      writer: {
        workingDirectory: "/sandbox/repo",
        async mkdir() {},
        async writeFile(path, content) {
          files.set(path, content);
        },
      },
      roster: compileFilesystemRoster(compiled),
    });
    expect(written.length).toBe(files.size);
    expect(
      files.has(
        "/sandbox/repo/.open-agents/agents/finance_ops/cfo/instructions.md",
      ),
    ).toBe(true);
    await expect(
      materializeFilesystemRoster({
        writer: {
          workingDirectory: "/sandbox/repo",
          async mkdir() {},
          async writeFile() {},
        },
        roster: [],
        root: "../escape",
      }),
    ).rejects.toThrow("safe relative path");
  });

  it("fails closed for undeclared harness tools and reserved pack fields", () => {
    const badTool = structuredClone(FINANCE_OPS_PACK);
    badTool.toolGrants.push({
      tool: "secret_admin",
      operations: ["write"],
      approvalRequired: false,
    });
    expect(() =>
      compileOperatingPacks({ graph, harness, manifests: [badTool] }),
    ).toThrow("undeclared harness capability");

    const badPrimitive = structuredClone(GRANT_OPS_PACK);
    badPrimitive.ontology.extensions.opportunity?.push("version");
    expect(() =>
      compileOperatingPacks({ graph, harness, manifests: [badPrimitive] }),
    ).toThrow("reserved primitive");

    const ungrantedAgentTool = structuredClone(FINANCE_OPS_PACK);
    ungrantedAgentTool.agents[0]?.tools.push("secret_admin");
    expect(() =>
      compileOperatingPacks({
        graph,
        harness,
        manifests: [ungrantedAgentTool],
      }),
    ).toThrow("agent tool is not granted");

    const unknownWorkflowAgent = structuredClone(FINANCE_OPS_PACK);
    unknownWorkflowAgent.workflows[0]?.agentIds.push("ghost");
    expect(() =>
      compileOperatingPacks({
        graph,
        harness,
        manifests: [unknownWorkflowAgent],
      }),
    ).toThrow("non-cross-pack workflow references external agent");

    const invalidOperation = structuredClone(FINANCE_OPS_PACK);
    invalidOperation.toolGrants[0]?.operations.push("delete");
    expect(() =>
      compileOperatingPacks({
        graph,
        harness,
        manifests: [invalidOperation],
      }),
    ).toThrow("undeclared harness operation");
  });

  it("orders dependencies and rejects cyclic pack installation", () => {
    const compiled = compileOperatingPacks({
      graph,
      harness,
      manifests: [SALES_OPS_PACK, PRODUCT_OPS_PACK, FINANCE_OPS_PACK],
    });
    expect(compiled.manifests.map((manifest) => manifest.id)).toEqual([
      "product_ops",
      "finance_ops",
      "sales_ops",
    ]);

    const finance = structuredClone(FINANCE_OPS_PACK);
    const grants = structuredClone(GRANT_OPS_PACK);
    finance.dependencies = ["grant_ops"];
    grants.dependencies = ["finance_ops"];
    expect(() =>
      compileOperatingPacks({ graph, harness, manifests: [finance, grants] }),
    ).toThrow("dependency cycle");
  });

  it("computes deterministic deny-first policy, approvals, budgets, and kill switches", () => {
    const invocation = {
      targets: [
        { scope: "workspace" as const, id: "ws_1" },
        { scope: "tool" as const, id: "circle_pay_service" },
      ],
      permission: "wallet:spend" as const,
      tool: "circle_pay_service",
      operation: "pay",
      estimatedCostUsd: 5,
      externalWrite: true,
    };
    const rules = [
      {
        id: "workspace_wallet",
        target: { scope: "workspace" as const, id: "ws_1" },
        effect: "allow" as const,
        permissions: ["wallet:spend" as const],
        approvalRequired: true,
        budgetUsd: 10,
      },
      {
        id: "deny_tool",
        target: { scope: "tool" as const, id: "circle_pay_service" },
        effect: "deny" as const,
        permissions: ["wallet:spend" as const],
      },
    ];
    expect(
      evaluateEffectivePolicy({ invocation, rules, killSwitches: [] }),
    ).toMatchObject({
      allowed: false,
      approvalRequired: true,
      reason: "denied by deny_tool",
    });
    expect(
      evaluateEffectivePolicy({
        invocation,
        rules: rules.slice(0, 1),
        killSwitches: [
          {
            id: "stop_writes",
            target: { scope: "workspace", id: "ws_1" },
            active: true,
            externalWritesOnly: true,
            reason: "incident",
          },
        ],
      }),
    ).toMatchObject({ allowed: false, killSwitchIds: ["stop_writes"] });
    expect(
      evaluateEffectivePolicy({
        invocation: {
          ...invocation,
          permission: "data:read",
          tool: "knowledge_read",
          operation: "query",
          externalWrite: false,
        },
        rules: [
          {
            id: "read_only",
            target: { scope: "workspace", id: "ws_1" },
            effect: "allow",
            permissions: ["data:read"],
          },
        ],
        killSwitches: [
          {
            id: "stop_writes",
            target: { scope: "workspace", id: "ws_1" },
            active: true,
            externalWritesOnly: true,
            reason: "incident",
          },
        ],
      }).allowed,
    ).toBe(true);
  });

  it("governs install, permission escalation, removal, and rollback without deleting graph data", () => {
    const decision = reviewPackChange({
      workspaceId: "ws_1",
      runId: "run_pack",
      actorId: "admin_1",
      candidate: FINANCE_OPS_PACK,
      allowedPermissions: ["data:read", "erp:write", "wallet:read"],
      atMs: 100,
    });
    expect(decision).toMatchObject({ allowed: true, approvalRequired: true });
    expect(decision.trace.data).not.toHaveProperty("secret");
    expect(
      reviewPackChange({
        workspaceId: "ws_1",
        runId: "run_denied",
        actorId: "admin_1",
        candidate: FINANCE_OPS_PACK,
        allowedPermissions: ["data:read"],
        atMs: 101,
      }).allowed,
    ).toBe(false);
    const installation = {
      workspaceId: "ws_1",
      manifest: FINANCE_OPS_PACK,
      state: "installed" as const,
      installedBy: "admin_1",
      installedAtMs: 100,
      previousVersion: { ...FINANCE_OPS_PACK, version: "0.9.0" },
    };
    expect(removeOperatingPack(installation, 200)).toMatchObject({
      preservedGraphData: true,
      installation: { state: "removed" },
    });
    expect(rollbackOperatingPack(installation).manifest.version).toBe("0.9.0");
  });

  it("builds evidence-backed KPI scorecards and reports freshness", () => {
    const definition = KPIDefinitionSchema.parse({
      id: "runway",
      version: 1,
      name: "Runway",
      formula: "cash / monthly_burn",
      grain: "workspace",
      ownerEntityId: "team_finance",
      sourceKinds: ["accounting", "wallet", "workflow"],
      dimensions: ["currency"],
      period: "monthly",
      freshnessSloMs: 86_400_000,
      caveats: ["FX normalized"],
      packIds: ["finance_ops", "bufi_internal_ops"],
      goalIds: ["goal_growth"],
      teamIds: ["team_finance"],
    });
    const run = createMetricRun({
      id: "metric_1",
      definitionId: "runway",
      definitionVersion: 1,
      value: 12,
      unit: "months",
      periodStartMs: 0,
      periodEndMs: 100,
      inputs: { cash: 120_000, monthly_burn: 10_000 },
      evidenceHashes: ["sha256:evidence"],
      traceId: "trace_metric",
      generatedAtMs: 100,
      staleAtMs: 200,
      confidence: 0.98,
    });
    expect(
      buildScorecard({
        definitions: [definition],
        runs: [run],
        nowMs: 150,
        packId: "finance_ops",
      })[0],
    ).toMatchObject({ status: "current", latest: { value: 12 } });
    expect(
      buildScorecard({ definitions: [definition], runs: [run], nowMs: 250 })[0]
        ?.status,
    ).toBe("stale");
  });

  it("simulates without effects and detects replay drift", () => {
    const packet = buildContextPacket({
      workspaceId: "ws_1",
      authorizationScope: "scope_read",
      graphWatermark: graph.watermark,
      projectionWatermark: "projection_1",
      ontologyVersion: "ontology_1",
      query: "grant opportunity",
      intent: "grant-review",
      budgets: {
        maxReferences: 5,
        maxSnippetChars: 80,
        maxRestrictedReferences: 0,
      },
      rankFusionVersion: "rrf_1",
      embedding: { provider: "typesense", model: "hybrid", inputVersion: "v1" },
      workflowRunId: "run_1",
      agentRunId: "agent_1",
      traceId: "trace_1",
      generatedAtMs: 100,
      expiresAtMs: 200,
      references: [
        {
          id: "ref_1",
          kind: "source-artifact",
          sourceId: "artifact_1",
          observedAtMs: 90,
          confidence: 1,
          redaction: "metadata-only",
          scores: { lexical: 1, vector: 1, graph: 1, recency: 1 },
          rank: 1,
          snippet: "Grant evidence",
          evidenceVersion: 1,
        },
      ],
    });
    const simulation = simulatePackWorkflow({
      graph,
      contextPacket: packet,
      manifest: GRANT_OPS_PACK,
      workflowId: "grant_opportunity_review",
      connectorFreshness: {
        knowledge_graph: "current",
        funder_portal: "missing",
      },
    });
    expect(simulation).toMatchObject({
      externalEffectsExecuted: 0,
      risk: "medium",
      requiredApprovals: ["workflow:grant_opportunity_review"],
    });
    expect(simulation.missingEvidence).toContain("funder_portal:missing");
    expect(
      admitPackWorkflowExecution({
        manifest: GRANT_OPS_PACK,
        workflowId: "grant_opportunity_review",
        simulation,
      }).admitted,
    ).toBe(true);
    expect(
      admitPackWorkflowExecution({
        manifest: FINANCE_OPS_PACK,
        workflowId: "spend_approval",
      }),
    ).toEqual({
      admitted: false,
      reason: "high-risk workflow requires a matching dry-run simulation",
    });
    expect(
      replayDrift({
        original: simulation,
        currentGraphWatermark: "graph_changed",
        currentContextPacketHash: packet.packetHash,
      }),
    ).toEqual({ drifted: true, graphChanged: true, contextChanged: false });
  });

  it("ships BUFI internal ops and all starter packs as valid manifests", () => {
    for (const manifest of [
      ...STARTER_OPERATING_PACKS,
      BUFI_INTERNAL_OPS_PACK,
    ]) {
      expect(
        parseOperatingPackManifest(manifest).taxImplementation,
      ).toBeUndefined();
    }
    expect(PRODUCT_OPS_PACK.kpis).toContain("shipped_prs");
    expect(
      SALES_OPS_PACK.workflows.some((workflow) => workflow.crossPack),
    ).toBe(true);
  });
});
