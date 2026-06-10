import type { SandboxState } from "@open-agents/sandbox";
import { stepCountIs, ToolLoopAgent, type ToolSet } from "ai";
import { z } from "zod";
import { addCacheControl } from "./context-management";
import {
  type GatewayModelId,
  gateway,
  type ProviderOptionsByProvider,
} from "./models";

import type { SkillMetadata } from "./skills/types";
import { buildSystemPrompt } from "./system-prompt";
import {
  askUserQuestionTool,
  bashTool,
  editFileTool,
  findResolvedGapTool,
  getPhoenixMcpToolsIfReady,
  globTool,
  grepTool,
  readFileTool,
  recallSimilarRunsTool,
  skillTool,
  taskTool,
  todoWriteTool,
  webFetchTool,
  writeFileTool,
} from "./tools";

export interface AgentModelSelection {
  id: GatewayModelId;
  providerOptionsOverrides?: ProviderOptionsByProvider;
}

export type OpenAgentModelInput = GatewayModelId | AgentModelSelection;

export interface AgentSandboxContext {
  state: SandboxState;
  workingDirectory: string;
  currentBranch?: string;
  environmentDetails?: string;
}

/**
 * Telemetry context stamped onto AI SDK spans as
 * `experimental_telemetry.metadata` so Phoenix traces correlate back
 * to Open Agents sessions, chats, and dispatch origins.
 */
export interface AgentTelemetryContext {
  sessionId?: string;
  chatId?: string;
  /** "web" (human UI) or "bufi-dispatch" (minion bridge). */
  source?: string;
  linearTaskId?: string;
  repo?: string;
}

const callOptionsSchema = z.object({
  sandbox: z.custom<AgentSandboxContext>(),
  model: z.custom<OpenAgentModelInput>().optional(),
  subagentModel: z.custom<OpenAgentModelInput>().optional(),
  customInstructions: z.string().optional(),
  skills: z.custom<SkillMetadata[]>().optional(),
  telemetry: z.custom<AgentTelemetryContext>().optional(),
});

export type OpenAgentCallOptions = z.infer<typeof callOptionsSchema>;

export const defaultModelLabel = "google/gemini-3-pro-preview" as const;
export const defaultModel = gateway(defaultModelLabel);

function normalizeAgentModelSelection(
  selection: OpenAgentModelInput | undefined,
  fallbackId: GatewayModelId,
): AgentModelSelection {
  if (!selection) {
    return { id: fallbackId };
  }

  return typeof selection === "string" ? { id: selection } : selection;
}

const tools = {
  todo_write: todoWriteTool,
  read: readFileTool(),
  write: writeFileTool(),
  edit: editFileTool(),
  grep: grepTool(),
  glob: globTool(),
  bash: bashTool(),
  task: taskTool,
  ask_user_question: askUserQuestionTool,
  skill: skillTool,
  web_fetch: webFetchTool,
  recall_similar_runs: recallSimilarRunsTool,
  find_resolved_gap: findResolvedGapTool,
} satisfies ToolSet;

export const openAgent = new ToolLoopAgent({
  model: defaultModel,
  instructions: buildSystemPrompt({}),
  tools,
  stopWhen: stepCountIs(1),
  callOptionsSchema,
  prepareStep: ({ messages, model, steps: _steps }) => {
    return {
      messages: addCacheControl({
        messages,
        model,
      }),
    };
  },
  prepareCall: ({ options, ...settings }) => {
    if (!options) {
      throw new Error("Open Agent requires call options with sandbox.");
    }

    const mainSelection = normalizeAgentModelSelection(
      options.model,
      defaultModelLabel,
    );
    const subagentSelection = options.subagentModel
      ? normalizeAgentModelSelection(options.subagentModel, defaultModelLabel)
      : undefined;

    const callModel = gateway(mainSelection.id, {
      providerOptionsOverrides: mainSelection.providerOptionsOverrides,
    });
    const subagentModel = subagentSelection
      ? gateway(subagentSelection.id, {
          providerOptionsOverrides: subagentSelection.providerOptionsOverrides,
        })
      : undefined;
    const customInstructions = options.customInstructions;
    const sandbox = options.sandbox;
    const skills = options.skills ?? [];

    const instructions = buildSystemPrompt({
      cwd: sandbox.workingDirectory,
      currentBranch: sandbox.currentBranch,
      customInstructions,
      environmentDetails: sandbox.environmentDetails,
      skills,
      modelId: mainSelection.id,
    });

    // OpenInference tracing → Arize Phoenix. AI SDK spans only fire
    // when a global tracer provider is registered (instrumentation.ts);
    // without PHOENIX_API_KEY this resolves to the noop tracer.
    const telemetryContext = options.telemetry;
    const telemetryMetadata: Record<string, string> = {};
    if (telemetryContext?.sessionId) {
      telemetryMetadata.sessionId = telemetryContext.sessionId;
    }
    if (telemetryContext?.chatId) {
      telemetryMetadata.chatId = telemetryContext.chatId;
    }
    if (telemetryContext?.source) {
      telemetryMetadata.source = telemetryContext.source;
    }
    if (telemetryContext?.linearTaskId) {
      telemetryMetadata.linearTaskId = telemetryContext.linearTaskId;
    }
    if (telemetryContext?.repo) {
      telemetryMetadata.repo = telemetryContext.repo;
    }

    // Phoenix MCP tools (self-introspection over stdio). Non-blocking:
    // empty while the client connects, merged in on later steps.
    const phoenixMcpTools = getPhoenixMcpToolsIfReady();

    return {
      ...settings,
      model: callModel,
      tools: addCacheControl({
        tools: { ...(settings.tools ?? tools), ...phoenixMcpTools },
        model: callModel,
      }),
      instructions,
      experimental_telemetry: {
        isEnabled: Boolean(process.env.PHOENIX_API_KEY),
        functionId: "open-agent",
        recordInputs: true,
        recordOutputs: true,
        metadata: telemetryMetadata,
      },
      experimental_context: {
        sandbox,
        skills,
        model: callModel,
        subagentModel,
      },
    };
  },
});

export type OpenAgent = typeof openAgent;
