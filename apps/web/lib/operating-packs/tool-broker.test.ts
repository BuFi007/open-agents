import { describe, expect, mock, test } from "bun:test";
import { buildContextPacket } from "@open-agents/knowledge";
import type { ToolSet } from "ai";
import { createOperatingPackBrokerTools } from "./tool-broker";

type ExecutableTool = {
  execute?: (input: unknown, options?: unknown) => Promise<unknown> | unknown;
};

async function execute(tools: ToolSet, name: string, input: unknown) {
  const candidate = tools[name] as ExecutableTool | undefined;
  if (!candidate?.execute) throw new Error(`Missing tool: ${name}`);
  return candidate.execute(input, {});
}

const context = {
  workspaceId: "11111111-1111-4111-8111-111111111111",
  workspaceGrant: "signed-workspace-grant".padEnd(100, "x"),
  executionId: "op_test",
  allowedTools: ["knowledge_read", "workflow_run"] as const,
};

describe("operating-pack host tool broker", () => {
  test("exposes only compiled grants and signs workspace-bound calls", async () => {
    const packet = buildContextPacket({
      workspaceId: context.workspaceId,
      authorizationScope: "scope:knowledge-read",
      graphWatermark: "graph:1",
      projectionWatermark: "projection:1",
      ontologyVersion: "ontology:1",
      query: "Acme",
      intent: "knowledge-read",
      budgets: {
        maxReferences: 1,
        maxSnippetChars: 100,
        maxRestrictedReferences: 0,
      },
      rankFusionVersion: "rrf:1",
      embedding: {
        provider: "typesense",
        model: "hybrid",
        inputVersion: "v1",
      },
      workflowRunId: context.executionId,
      agentRunId: "agent:1",
      traceId: "trace:1",
      generatedAtMs: 1_000,
      expiresAtMs: 2_000,
      references: [],
    });
    const fetchImpl = mock(
      async (_url: string | URL | Request, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        expect(headers.get("x-bufi-signature")).toMatch(/^[a-f0-9]{64}$/);
        expect(JSON.parse(String(init?.body))).toMatchObject({
          workspaceId: context.workspaceId,
          workspaceGrant: context.workspaceGrant,
          tool: "knowledge_read",
        });
        return Response.json({ result: packet });
      },
    );
    const tools = createOperatingPackBrokerTools(context, {
      brokerUrl: "https://desk.test/api/internal/agent-tools",
      brokerSecret: "test-secret-that-is-at-least-thirty-two-bytes",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(Object.keys(tools).sort()).toEqual([
      "knowledge_read",
      "workflow_run",
    ]);
    expect(
      await execute(tools, "knowledge_read", { query: "Acme", limit: 5 }),
    ).toEqual(packet);
  });

  test("rejects tampered and cross-run knowledge packets", async () => {
    const invalidResults = [
      { packetHash: "not-a-packet" },
      buildContextPacket({
        workspaceId: context.workspaceId,
        authorizationScope: "scope:knowledge-read",
        graphWatermark: "graph:1",
        projectionWatermark: "projection:1",
        ontologyVersion: "ontology:1",
        query: "Acme",
        intent: "knowledge-read",
        budgets: {
          maxReferences: 1,
          maxSnippetChars: 100,
          maxRestrictedReferences: 0,
        },
        rankFusionVersion: "rrf:1",
        embedding: {
          provider: "typesense",
          model: "hybrid",
          inputVersion: "v1",
        },
        workflowRunId: "another-run",
        agentRunId: "agent:1",
        traceId: "trace:1",
        generatedAtMs: 1_000,
        expiresAtMs: 2_000,
        references: [],
      }),
    ];
    for (const result of invalidResults) {
      const tools = createOperatingPackBrokerTools(context, {
        brokerUrl: "https://desk.test/api/internal/agent-tools",
        brokerSecret: "test-secret-that-is-at-least-thirty-two-bytes",
        fetchImpl: (async () =>
          Response.json({ result })) as unknown as typeof fetch,
      });
      await expect(
        execute(tools, "knowledge_read", { query: "Acme", limit: 5 }),
      ).rejects.toThrow(/context packet|agent run/);
    }
  });

  test("fails closed for nested workflow starts", async () => {
    const tools = createOperatingPackBrokerTools(context);
    await expect(
      execute(tools, "workflow_run", {
        operation: "start",
        workflowId: "nested",
      }),
    ).rejects.toThrow("separately approved durable run");
  });
});
