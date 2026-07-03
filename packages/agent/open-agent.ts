import type { SandboxState } from "@open-agents/sandbox";
import { isStepCount, ToolLoopAgent, type ToolSet } from "ai";
import { z } from "zod";
import { addCacheControl } from "./context-management";
import {
  type GatewayModelId,
  gateway,
  type ProviderOptionsByProvider,
} from "./models";

import type { SkillMetadata } from "./skills/types";
import { buildSystemPrompt } from "./system-prompt";
import type { AgentContext } from "./types";
import {
  askUserQuestionTool,
  bashTool,
  editFileTool,
  globTool,
  grepTool,
  readFileTool,
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
 * `experimental_telemetry.metadata` so exported spans correlate back
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
} satisfies ToolSet;

// AI SDK 7 requires contextual tools to have an initial context map. Every
// actual call replaces these placeholders in prepareCall before tool execution.
const initialAgentContext = {} as AgentContext;

export const openAgent = new ToolLoopAgent({
  model: defaultModel,
  instructions: buildSystemPrompt({}),
  tools,
  toolsContext: {
    read: initialAgentContext,
    write: initialAgentContext,
    edit: initialAgentContext,
    grep: initialAgentContext,
    glob: initialAgentContext,
    bash: initialAgentContext,
    task: initialAgentContext,
    skill: initialAgentContext,
    web_fetch: initialAgentContext,
  },
  stopWhen: isStepCount(1),
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
    const agentContext = {
      sandbox,
      skills,
      model: callModel,
      subagentModel,
    };

    const instructions = buildSystemPrompt({
      cwd: sandbox.workingDirectory,
      currentBranch: sandbox.currentBranch,
      customInstructions,
      environmentDetails: sandbox.environmentDetails,
      skills,
      modelId: mainSelection.id,
    });

    // AI SDK telemetry metadata — spans only fire when a global tracer
    // provider is registered; noop until native/eve tracing is wired.
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

    return {
      ...settings,
      model: callModel,
      tools: addCacheControl({
        tools: settings.tools ?? tools,
        model: callModel,
      }),
      instructions,
      // BUFI: AI SDK telemetry stays plumbed for native/eve tracing.
      experimental_telemetry: {
        isEnabled: process.env.AGENT_TELEMETRY_ENABLED === "1",
        functionId: "open-agent",
        recordInputs: true,
        recordOutputs: true,
        metadata: telemetryMetadata,
      },
      // AI SDK 7 per-tool context (replaces experimental_context). agentContext
      // carries sandbox/skills/model — see its definition above.
      toolsContext: {
        read: agentContext,
        write: agentContext,
        edit: agentContext,
        grep: agentContext,
        glob: agentContext,
        bash: agentContext,
        task: agentContext,
        skill: agentContext,
        web_fetch: agentContext,
      },
    };
  },
});

export type OpenAgent = typeof openAgent;
