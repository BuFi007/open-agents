import { createHmac } from "node:crypto";
import {
  type ContextPacket,
  validateContextPacket,
} from "@open-agents/knowledge";
import { tool, type ToolSet } from "ai";
import { z } from "zod";

export const OPERATING_PACK_TOOL_NAMES = [
  "knowledge_read",
  "workflow_run",
  "circle_get_balance",
] as const;

export type OperatingPackToolName = (typeof OPERATING_PACK_TOOL_NAMES)[number];

export type OperatingPackBrokerContext = {
  workspaceId: string;
  workspaceGrant: string;
  executionId: string;
  allowedTools: readonly OperatingPackToolName[];
};

type BrokerFetch = typeof fetch;

function signBrokerRequest(
  secret: string,
  timestamp: string,
  requestId: string,
  body: string,
): string {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${requestId}.${body}`)
    .digest("hex");
}

async function callBroker(
  context: OperatingPackBrokerContext,
  toolName: "knowledge_read" | "circle_get_balance",
  args: Record<string, unknown>,
  options: {
    brokerUrl?: string;
    brokerSecret?: string;
    fetchImpl?: BrokerFetch;
  } = {},
): Promise<unknown> {
  const brokerUrl = options.brokerUrl ?? process.env.BUFI_AGENT_TOOL_BROKER_URL;
  const secret =
    options.brokerSecret ?? process.env.BUFI_AGENT_TOOL_BROKER_SECRET;
  if (!brokerUrl || !secret || secret.length < 32)
    throw new Error("BUFI agent tool broker is not configured");
  const body = JSON.stringify({
    workspaceId: context.workspaceId,
    executionId: context.executionId,
    workspaceGrant: context.workspaceGrant,
    tool: toolName,
    arguments: args,
  });
  const timestamp = String(Date.now());
  const requestId = `${context.executionId}:${toolName}:${crypto.randomUUID()}`;
  const response = await (options.fetchImpl ?? fetch)(brokerUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-bufi-timestamp": timestamp,
      "x-bufi-request-id": requestId,
      "x-bufi-signature": signBrokerRequest(secret, timestamp, requestId, body),
    },
    body,
  });
  const payload = (await response.json().catch(() => null)) as {
    result?: unknown;
    error?: unknown;
  } | null;
  if (!response.ok)
    throw new Error(
      typeof payload?.error === "string"
        ? payload.error
        : `BUFI tool broker failed (${response.status})`,
    );
  if (!payload || !("result" in payload))
    throw new Error("BUFI tool broker returned an invalid response");
  return payload.result;
}

function validateKnowledgePacket(
  value: unknown,
  context: OperatingPackBrokerContext,
): ContextPacket {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("BUFI knowledge broker returned an invalid context packet");
  let packet: ContextPacket;
  try {
    packet = validateContextPacket(value as ContextPacket);
  } catch {
    throw new Error("BUFI knowledge broker returned an invalid context packet");
  }
  if (
    packet.workspaceId !== context.workspaceId ||
    packet.workflowRunId !== context.executionId
  )
    throw new Error("BUFI knowledge packet is not bound to this agent run");
  return packet;
}

export function createOperatingPackBrokerTools(
  context: OperatingPackBrokerContext,
  options: {
    brokerUrl?: string;
    brokerSecret?: string;
    fetchImpl?: BrokerFetch;
  } = {},
): ToolSet {
  const allowed = new Set(context.allowedTools);
  const tools: ToolSet = {};
  if (allowed.has("knowledge_read")) {
    tools.knowledge_read = tool({
      description:
        "Search the bound BUFI workspace knowledge graph and return a persisted, cited evidence packet.",
      inputSchema: z.object({
        query: z.string().trim().min(1).max(4000),
        limit: z.number().int().min(1).max(50).default(12),
      }),
      execute: async (args) =>
        validateKnowledgePacket(
          await callBroker(context, "knowledge_read", args, options),
          context,
        ),
    });
  }
  if (allowed.has("circle_get_balance")) {
    tools.circle_get_balance = tool({
      description:
        "Read the live Circle token balance for this workspace's isolated agent wallet.",
      inputSchema: z.object({
        chain: z.string().trim().min(1).max(64).optional(),
        currency: z.enum(["USDC", "EURC"]).default("USDC"),
      }),
      execute: (args) =>
        callBroker(context, "circle_get_balance", args, options),
    });
  }
  if (allowed.has("workflow_run")) {
    tools.workflow_run = tool({
      description:
        "Inspect the current durable workflow. Nested workflow starts are intentionally denied at this read-only boundary.",
      inputSchema: z.object({
        operation: z.enum(["inspect", "start"]),
        workflowId: z.string().min(1).max(191).optional(),
      }),
      execute: async ({ operation, workflowId }) => {
        if (operation === "start")
          throw new Error(
            "Nested workflow starts require a separately approved durable run",
          );
        return {
          executionId: context.executionId,
          workspaceId: context.workspaceId,
          workflowId: workflowId ?? null,
          durable: true,
          nestedStartsAllowed: false,
        };
      },
    });
  }
  return tools;
}
