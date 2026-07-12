import type {
  ExternalHarnessId,
  HarnessTurnResult,
  HarnessUIMessage,
  HarnessUIMessageChunk,
} from "@open-agents/harness-runner";
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
        allowedTools: z
          .array(
            z.enum([
              "knowledge_read",
              "workflow_run",
              "circle_get_balance",
              "circle_login",
              "circle_logout",
              "fetch_setup_skill",
              "fetch_sub_skill",
              "circle_list_wallets",
              "circle_create_wallet",
              "circle_deploy_wallet",
              "circle_wallet_fund",
              "circle_fund_fiat",
              "circle_get_gateway_balance",
              "circle_search_services",
              "circle_inspect_service",
              "fetch_service",
              "call_free_service",
              "circle_pay_service",
              "circle_gateway_deposit",
            ]),
          )
          .max(20),
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
