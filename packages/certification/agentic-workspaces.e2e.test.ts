import { createHmac } from "node:crypto";
import { describe, expect, it } from "bun:test";
import {
  BUFI_AGENT_WALLET_UI_CHECKLIST,
  CIRCLE_AGENT_WALLET_TOOL_NAMES,
  CIRCLE_AGENT_WALLET_WORKFLOW,
  requiresHumanApproval,
  validateAgentWalletToolSet,
} from "@open-agents/agent-wallet";
import {
  buildDeskCommandCenter,
  buildExpoWorkflowInbox,
} from "@open-agents/command-center";
import {
  compileConnectorLeafJobs,
  createSourceArtifact,
  type ConnectorEventRegistry,
  type ConnectorManifest,
  verifySignedConnectorEvent,
} from "@open-agents/connectors";
import {
  createEffectStore,
  createExportPayableCommand,
  createPayableFromArtifactCommand,
} from "@open-agents/effects";
import {
  createMcpInvocationEvent,
  createWorkspaceHarness,
} from "@open-agents/harness-runner";
import {
  buildContextPacket,
  buildGrantOntology,
  createKnowledgeChangeSet,
  createKnowledgeStore,
  createOutbox,
  evaluateProductionGate,
  publishOntology,
} from "@open-agents/knowledge";
import { createQueuePlan, evaluateWorkerAdmission } from "@open-agents/queues";
import { createTrace } from "@open-agents/traces";
import { runWorkflow, type WorkflowStore } from "@open-agents/workflow";

const hash =
  "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

describe("Agentic Workspaces contract E2E", () => {
  it("replays a connected workspace operation through evidence, workflow, traces, and command centers", async () => {
    expect(validateAgentWalletToolSet(CIRCLE_AGENT_WALLET_TOOL_NAMES)).toEqual({
      missing: [],
      unknown: [],
    });
    expect(CIRCLE_AGENT_WALLET_WORKFLOW.map((step) => step.id)).toEqual([
      "read-setup",
      "session",
      "wallet",
      "balance",
      "funding-guidance",
      "service-discovery",
      "payment",
    ]);
    expect(requiresHumanApproval("circle_pay_service")).toBe(true);
    expect(requiresHumanApproval("circle_gateway_deposit")).toBe(true);
    expect(BUFI_AGENT_WALLET_UI_CHECKLIST.map((item) => item.id)).toContain(
      "approval-boundaries",
    );

    const manifest: ConnectorManifest = {
      version: 1,
      workspaceId: "ws_1",
      connectionId: "conn_gmail",
      adapter: "pipedream",
      appSlug: "gmail",
      ownerMode: "team-shared",
      credentialRef: "vault/pipedream/gmail",
      environment: "development",
      deploymentId: "dep_12345678",
      accounts: [
        {
          accountId: "acct_1",
          externalAccountId: "pd_1",
          label: "Gmail",
          isDefault: true,
        },
      ],
      capabilities: ["trigger", "knowledge-ingestion"],
      stages: ["canonical-write", "enrichment", "projection"],
      freshnessSloMs: 3_600_000,
      schemaVersion: "gmail.attachment.v1",
      redactionPolicy: "metadata-only",
    };
    const unsigned = {
      deploymentId: "dep_12345678",
      environment: "development" as const,
      eventId: "evt_12345678",
      timestampMs: 1000,
      rawBody: '{"message":"msg_1"}',
    };
    const signature = createHmac("sha256", "super-secret-signing-key")
      .update(
        `${unsigned.timestampMs}.${unsigned.eventId}.${unsigned.deploymentId}.${unsigned.rawBody}`,
      )
      .digest("hex");
    const seen = new Set<string>();
    const registry: ConnectorEventRegistry = {
      async getByDeploymentId() {
        return manifest;
      },
      async consumeEvent({ eventId }) {
        if (seen.has(eventId)) return false;
        seen.add(eventId);
        return true;
      },
    };
    const verified = await verifySignedConnectorEvent(
      { ...unsigned, signature },
      registry,
      async () => "super-secret-signing-key",
      1000,
    );
    expect(verified.workspaceId).toBe("ws_1");

    const artifact = createSourceArtifact({
      workspaceId: "ws_1",
      connectorId: manifest.connectionId,
      provider: "gmail",
      accountId: "acct_1",
      externalContainerId: "msg_1",
      externalArtifactId: "att_1",
      contentHash: hash,
      mimeType: "application/pdf",
      sizeBytes: 42,
      receivedAtMs: 900,
      observedAtMs: 1000,
      safeStorageRef: "storage/gmail/att_1",
      schemaVersion: "source-artifact.v1",
      normalizerVersion: "gmail.v1",
      correlationId: "corr_1",
      redaction: "metadata-only",
    });
    const plan = createQueuePlan(compileConnectorLeafJobs(manifest, "rev_1"));
    expect(plan.jobs).toHaveLength(3);
    expect(
      evaluateWorkerAdmission({
        profile: "knowledge-ai",
        workspaceId: "ws_1",
        queue: "embedding",
        activeForWorkspace: 0,
        replicas: 1,
      }).admitted,
    ).toBe(true);

    const knowledge = createKnowledgeStore();
    const entity = await knowledge.resolveOrCreate({
      workspaceId: "ws_1",
      kind: "vendor",
      externalKey: artifact.artifactKey,
      name: "Acme",
    });
    const outbox = createOutbox();
    await outbox.append({
      id: "outbox_1",
      workspaceId: "ws_1",
      topic: "knowledge.write",
      payload: { entityId: entity.id, artifactKey: artifact.artifactKey },
    });
    expect((await outbox.claim(1))[0]?.workspaceId).toBe("ws_1");

    const packet = buildContextPacket({
      workspaceId: "ws_1",
      authorizationScope: "scope_read",
      graphWatermark: "graph_1",
      projectionWatermark: "projection_1",
      ontologyVersion: "ontology_1",
      query: "invoice evidence",
      intent: "cfo-review",
      budgets: {
        maxReferences: 5,
        maxSnippetChars: 80,
        maxRestrictedReferences: 0,
      },
      rankFusionVersion: "rrf_1",
      embedding: { provider: "typesense", model: "hybrid", inputVersion: "v1" },
      workflowRunId: "run_1",
      agentRunId: "agent_cfo_1",
      traceId: "trace_1",
      generatedAtMs: 1100,
      expiresAtMs: 2100,
      references: [
        {
          id: "ref_1",
          kind: "source-artifact",
          sourceId: artifact.artifactKey,
          observedAtMs: artifact.observedAtMs,
          confidence: 1,
          redaction: "metadata-only",
          scores: { lexical: 0.9, vector: 0.8, graph: 0.7, recency: 0.9 },
          rank: 1,
          snippet: "Gmail attachment evidence",
          evidenceVersion: 1,
        },
      ],
    });
    expect(packet.citations[0]?.handle).toBe("c1");

    const changeSet = createKnowledgeChangeSet({
      id: "cs_1",
      workspaceId: "ws_1",
      version: 1,
      trustTier: "deterministic-source",
      origin: {
        sourceArtifactKey: artifact.artifactKey,
        contextPacketHash: packet.packetHash,
      },
      evidenceIds: ["ref_1"],
      observedAtMs: 1100,
      confidence: 1,
      method: { name: "gmail-normalizer", schemaVersion: "v1" },
      changes: [
        {
          targetId: entity.id,
          operation: "update",
          field: "latestArtifact",
          nextValue: artifact.artifactKey,
        },
      ],
      eveTraceId: "trace_1",
    });
    expect(changeSet.decision).toBe("auto-commit");

    const grant = publishOntology(buildGrantOntology("ws_1", "admin_1"));
    expect(grant.agentTools).toContain("workspace_Grant_propose");

    const effects = createEffectStore();
    const payable = await effects.upsert(
      createPayableFromArtifactCommand(artifact),
    );
    const exportCommand = await effects.upsert(
      createExportPayableCommand({
        workspaceId: "ws_1",
        billId: "bill_1",
        provider: "xero",
        providerTenantId: "tenant_1",
      }),
    );
    expect(payable.status).toBe("pending");
    expect(exportCommand.provider).toBe("xero");

    const harness = createWorkspaceHarness({
      harnessId: "hermes",
      workspaceId: "ws_1",
      teamId: "team_1",
      userId: "user_1",
      sessionId: "session_1",
      connectionState: "connected",
      sandboxRef: "sandbox_1",
      capabilities: [
        {
          name: "defi_quote",
          server: "bufi-hyper",
          scopes: ["defi.read"],
          requiresApproval: false,
          allowedOperations: ["quote"],
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
    expect(
      createMcpInvocationEvent(harness, {
        capability: "defi_quote",
        operation: "quote",
        atMs: 1200,
      }).server,
    ).toBe("bufi-hyper");

    const trace = createTrace({
      workspaceId: "ws_1",
      runId: "run_1",
      type: "artifact.emitted",
      summary: "context packet emitted",
      data: { packetHash: packet.packetHash, secret: "redacted" },
      at: 1300,
    });
    expect(trace.data).not.toHaveProperty("secret");

    const store: WorkflowStore = { async append() {}, async save() {} };
    const workflow = await runWorkflow(
      {
        id: "wf_1",
        workspaceId: "ws_1",
        input: { packetHash: packet.packetHash },
        budgetMs: 10_000,
        steps: [
          {
            id: "cfo",
            agentId: "cfo",
            async run() {
              return { packetHash: packet.packetHash };
            },
          },
        ],
      },
      { store, runId: "run_1" },
    );
    expect(workflow.status).toBe("completed");

    const desk = buildDeskCommandCenter({
      workspaceId: "ws_1",
      workflowId: "wf_1",
      runId: "run_1",
      nodes: [
        { id: "node_1", agentId: "cfo", status: "completed", label: "CFO" },
      ],
      edges: [],
      harness,
      traces: [trace],
      approvals: [],
      entityGraph: { nodes: 1, edges: 0, watermark: "graph_1" },
      savedQueries: [{ id: "query_1", label: "Evidence" }],
    });
    expect(desk.console).toHaveLength(1);
    expect(
      desk.agentWallet.tools.find((tool) => tool.name === "circle_get_balance")
        ?.available,
    ).toBe(true);
    expect(desk.agentWallet.workflow).toHaveLength(7);
    expect(
      buildExpoWorkflowInbox({
        workspaceId: "ws_1",
        workflowId: "wf_1",
        runId: "run_1",
        nodes: [
          { id: "node_1", agentId: "cfo", status: "completed", label: "CFO" },
        ],
        edges: [],
        harness,
        traces: [trace],
        approvals: [],
        entityGraph: { nodes: 1, edges: 0, watermark: "graph_1" },
        savedQueries: [],
      }).cards[0]?.status,
    ).toBe("completed");

    expect(
      evaluateProductionGate({
        migrationReplay: true,
        tenantIsolation: true,
        restartLosses: 0,
        contextP95Ms: 100,
        firstPageP95Ms: 100,
        outboxP95Ms: 1000,
        recallAtK: 0.9,
        chaosPassed: true,
        mixedWorkloadPassed: true,
        outboxChaosPassed: true,
        prioritySloProtected: true,
      }).passed,
    ).toBe(true);
  });
});
