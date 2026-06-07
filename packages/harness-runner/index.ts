import { codex } from "@agent-harness-experimental/adapter-codex";
import { createVercelSandboxBackend } from "@agent-harness-experimental/sandbox-vercel";
import type { AgentHarnessHostedWorkspace } from "@open-agents/sandbox/vercel";
import {
  createAgentSession,
  ensureGatewayApiKeyEnv,
  provideSandbox,
} from "agent-harness-experimental";
import { readUIMessageStream } from "ai";

export type ExternalHarnessId = "codex";

export type HarnessUIMessage = {
  id: string;
  role: "user" | "assistant";
  parts: Array<Record<string, unknown>>;
  metadata?: Record<string, unknown>;
};

export type HarnessUIMessageChunk = {
  type: string;
  [key: string]: unknown;
};

export type HarnessUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
  inputTokenDetails?: {
    noCacheTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
  outputTokenDetails?: {
    textTokens?: number;
    reasoningTokens?: number;
  };
  costUsd?: number;
};

export type HarnessTurnResult = {
  responseMessage: HarnessUIMessage;
  finishReason:
    | "stop"
    | "length"
    | "content-filter"
    | "tool-calls"
    | "error"
    | "other";
  rawFinishReason?: string;
  usage?: HarnessUsage;
};

export type RunHarnessTurnInput = {
  harnessId: ExternalHarnessId;
  workspace: AgentHarnessHostedWorkspace;
  workingDirectory: string;
  sessionId: string;
  messageId: string;
  messages: HarnessUIMessage[];
  originalMessages: HarnessUIMessage[];
  selectedModelId: string;
  modelId: string;
  abortSignal?: AbortSignal;
  onChunk: (chunk: HarnessUIMessageChunk) => Promise<void> | void;
};

const OPEN_AGENT_TOOL_NAMES = new Set([
  "todo_write",
  "read",
  "write",
  "edit",
  "grep",
  "glob",
  "bash",
  "task",
  "ask_user_question",
  "skill",
  "web_fetch",
]);

function isOpenAgentToolName(toolName: unknown): toolName is string {
  return typeof toolName === "string" && OPEN_AGENT_TOOL_NAMES.has(toolName);
}

function stripDynamicFlag(chunk: HarnessUIMessageChunk): HarnessUIMessageChunk {
  const { dynamic: _dynamic, ...mappedChunk } = chunk;
  return mappedChunk;
}

export function mapOpenAgentToolChunk(
  chunk: HarnessUIMessageChunk,
): HarnessUIMessageChunk {
  if (
    (chunk.type === "tool-input-start" ||
      chunk.type === "tool-input-available" ||
      chunk.type === "tool-input-error") &&
    chunk.dynamic === true &&
    isOpenAgentToolName(chunk.toolName)
  ) {
    return stripDynamicFlag(chunk);
  }

  return chunk;
}

function createOpenAgentToolMappingStream(): TransformStream<
  HarnessUIMessageChunk,
  HarnessUIMessageChunk
> {
  return new TransformStream({
    transform(chunk, controller) {
      controller.enqueue(mapOpenAgentToolChunk(chunk));
    },
  });
}

function stringifyCompact(value: unknown): string {
  const serialized = JSON.stringify(value) ?? String(value);
  return serialized.length > 2_000
    ? `${serialized.slice(0, 2_000)}...`
    : serialized;
}

function formatAskUserQuestionOutput(output: unknown): string | null {
  if (typeof output !== "object" || output === null) {
    return null;
  }

  if ("declined" in output && output.declined === true) {
    return "User declined to answer the questions.";
  }

  if (!("answers" in output)) {
    return null;
  }

  const answers = output.answers;
  if (typeof answers !== "object" || answers === null) {
    return null;
  }

  const formattedAnswers = Object.entries(
    answers as Record<string, unknown>,
  ).map(([question, answer]) => {
    const formattedAnswer = Array.isArray(answer)
      ? answer.join(", ")
      : String(answer);
    return `"${question}"="${formattedAnswer}"`;
  });

  if (formattedAnswers.length === 0) {
    return "User answered the questions.";
  }

  return `User answered questions: ${formattedAnswers.join(", ")}.`;
}

function toolNameFromPart(part: Record<string, unknown>): string | null {
  if (part.type === "dynamic-tool" && typeof part.toolName === "string") {
    return part.toolName;
  }

  if (typeof part.type === "string" && part.type.startsWith("tool-")) {
    return part.type.slice("tool-".length);
  }

  return null;
}

function textFromToolPart(part: Record<string, unknown>): string | null {
  const toolName = toolNameFromPart(part);
  if (!toolName) {
    return null;
  }

  if (part.state === "approval-responded") {
    const approval =
      typeof part.approval === "object" && part.approval !== null
        ? (part.approval as Record<string, unknown>)
        : undefined;
    const approved = approval?.approved;
    if (approved === true) {
      return `User approved the ${toolName} tool call.`;
    }
    if (approved === false) {
      const reason =
        typeof approval?.reason === "string"
          ? ` Reason: ${approval.reason}`
          : "";
      return `User denied the ${toolName} tool call.${reason}`;
    }
  }

  if (part.state === "output-denied") {
    return `User denied the ${toolName} tool call.`;
  }

  if (part.state !== "output-available") {
    return null;
  }

  if (toolName === "ask_user_question") {
    return formatAskUserQuestionOutput(part.output);
  }

  if (!("output" in part)) {
    return null;
  }

  return `${toolName} tool output: ${stringifyCompact(part.output)}`;
}

function textFromPart(part: Record<string, unknown>): string | null {
  if (part.type === "text" && typeof part.text === "string") {
    return part.text;
  }

  if (part.type === "data-snippet" && typeof part.data === "object") {
    return JSON.stringify(part.data);
  }

  const toolText = textFromToolPart(part);
  if (toolText) {
    return toolText;
  }

  return null;
}

export function buildHarnessPrompt(messages: HarnessUIMessage[]): string {
  return messages
    .map((message) => {
      const text = message.parts
        .map(textFromPart)
        .filter((part): part is string => part !== null)
        .join("\n")
        .trim();

      if (!text) {
        return null;
      }

      return `${message.role === "assistant" ? "Assistant" : "User"}:\n${text}`;
    })
    .filter((message): message is string => message !== null)
    .join("\n\n");
}

export function resolveCodexModelId(modelId: string): string | undefined {
  return modelId.startsWith("openai/")
    ? modelId.slice("openai/".length)
    : undefined;
}

function withHarnessMetadata(
  message: HarnessUIMessage,
  input: Pick<RunHarnessTurnInput, "selectedModelId" | "modelId">,
  result: Pick<HarnessTurnResult, "finishReason" | "rawFinishReason" | "usage">,
): HarnessUIMessage {
  return {
    ...message,
    metadata: {
      ...message.metadata,
      selectedModelId: input.selectedModelId,
      modelId: input.modelId,
      ...(result.usage
        ? {
            lastStepUsage: result.usage,
            totalMessageUsage: result.usage,
          }
        : {}),
      lastStepFinishReason: result.finishReason,
      ...(result.rawFinishReason
        ? { lastStepRawFinishReason: result.rawFinishReason }
        : {}),
      stepFinishReasons: [
        {
          finishReason: result.finishReason,
          ...(result.rawFinishReason
            ? { rawFinishReason: result.rawFinishReason }
            : {}),
        },
      ],
    },
  };
}

export async function assembleHarnessResponseMessage(
  stream: ReadableStream<HarnessUIMessageChunk>,
  messageId: string,
): Promise<HarnessUIMessage> {
  let responseMessage: HarnessUIMessage = {
    id: messageId,
    role: "assistant",
    parts: [],
  };
  const mappedStream = stream.pipeThrough(createOpenAgentToolMappingStream());

  for await (const message of readUIMessageStream({
    message: responseMessage as never,
    stream: mappedStream as never,
    terminateOnError: true,
  })) {
    responseMessage = message as HarnessUIMessage;
  }

  return responseMessage;
}

export async function runHarnessTurn(
  input: RunHarnessTurnInput,
): Promise<HarnessTurnResult> {
  const prompt = buildHarnessPrompt(input.messages);
  if (!prompt) {
    throw new Error("Harness turn requires at least one text message");
  }

  await ensureGatewayApiKeyEnv();

  const backend = createVercelSandboxBackend();
  const provided = provideSandbox({
    backend,
    session: input.workspace,
    bridgePorts: [5001],
  });
  const agent = createAgentSession({
    adapter: codex({
      model: resolveCodexModelId(input.modelId),
    }),
    sessionId: input.sessionId,
    sandbox: {
      mode: "provided",
      provided,
      runtimeSetup: "refresh",
      workingDirectory: {
        kind: "path",
        path: input.workingDirectory,
      },
    },
  });

  try {
    const stream = await agent.stream({
      prompt,
      ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
    });
    const [outboundStream, responseStream] = stream
      .toUIMessageStream({
        originalMessages: input.originalMessages as never,
        generateMessageId: () => input.messageId,
        sendStart: false,
        sendFinish: false,
      })
      .pipeThrough(createOpenAgentToolMappingStream())
      .tee();
    const responseMessagePromise = assembleHarnessResponseMessage(
      responseStream as ReadableStream<HarnessUIMessageChunk>,
      input.messageId,
    );

    const outboundReader = outboundStream.getReader();
    while (true) {
      const { done, value } = await outboundReader.read();
      if (done) {
        break;
      }
      await input.onChunk(value as HarnessUIMessageChunk);
    }

    const [responseMessage, finishReason, rawFinishReason, usage] =
      await Promise.all([
        responseMessagePromise,
        stream.finishReason,
        stream.rawFinishReason,
        stream.totalUsage,
      ]);
    const result = {
      finishReason,
      rawFinishReason,
      usage,
    } satisfies Omit<HarnessTurnResult, "responseMessage">;

    const enrichedResponseMessage = withHarnessMetadata(
      responseMessage,
      input,
      result,
    );
    await input.onChunk({
      type: "message-metadata",
      messageMetadata: enrichedResponseMessage.metadata,
    });

    return {
      ...result,
      responseMessage: enrichedResponseMessage,
    };
  } finally {
    await agent.close("stop");
  }
}
