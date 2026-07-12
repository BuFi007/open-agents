import type {
  ExternalHarnessId,
  HarnessTurnResult,
  HarnessUIMessage,
  HarnessUIMessageChunk,
} from "@open-agents/harness-runner";
import { CIRCLE_AGENT_WALLET_TOOL_NAMES } from "@open-agents/agent-wallet";
import type { SandboxState } from "@open-agents/sandbox";
import { z } from "zod";
import type { OperatingPackBrokerContext } from "@/lib/operating-packs/tool-broker";

export type InternalHarnessRunRequest = {
  harnessId: ExternalHarnessId;
  sandboxState: SandboxState;
  workingDirectory: string;
  sessionId: string;
  messageId: string;
  messages: HarnessUIMessage[];
  originalMessages: HarnessUIMessage[];
  selectedModelId: string;
  modelId: string;
  instructions?: string;
  permissionMode?: "allow-reads" | "allow-edits" | "allow-all";
  brokerContext?: OperatingPackBrokerContext;
};

export type InternalHarnessRunEvent =
  | {
      type: "chunk";
      chunk: HarnessUIMessageChunk;
    }
  | {
      type: "result";
      result: HarnessTurnResult;
    }
  | {
      type: "error";
      error: string;
    };

const id = z.string().min(1).max(191);
const brokerToolNames = [
  "knowledge_read",
  "workflow_run",
  ...CIRCLE_AGENT_WALLET_TOOL_NAMES,
] as const;
const messageSchema = z
  .object({
    id,
    role: z.enum(["user", "assistant"]),
    parts: z.array(z.record(z.string(), z.unknown())).max(500),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const internalHarnessRunRequestSchema = z
  .object({
    harnessId: z.enum(["codex", "claude-code", "pi"]),
    sandboxState: z
      .object({ type: z.literal("vercel") })
      .passthrough()
      .transform((value) => value as SandboxState),
    workingDirectory: z.string().min(1).max(4096),
    sessionId: id,
    messageId: id,
    messages: z.array(messageSchema).min(1).max(100),
    originalMessages: z.array(messageSchema).max(100),
    selectedModelId: z.string().min(1).max(191),
    modelId: z.string().min(1).max(191),
    instructions: z.string().min(1).max(32_000).optional(),
    permissionMode: z
      .enum(["allow-reads", "allow-edits", "allow-all"])
      .optional(),
    brokerContext: z
      .object({
        workspaceId: z.string().uuid(),
        workspaceGrant: z.string().min(80).max(2048),
        executionId: id,
        agentRunId: id,
        allowedTools: z.array(z.enum(brokerToolNames)).max(20),
      })
      .strict()
      .optional(),
  })
  .strict();

export function parseInternalHarnessRunRequest(
  input: unknown,
): InternalHarnessRunRequest {
  return internalHarnessRunRequestSchema.parse(input);
}
