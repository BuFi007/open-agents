import type {
  HarnessMcpCapability,
  HarnessUIMessageChunk,
} from "@open-agents/harness-runner";
import {
  compileFilesystemRoster,
  compileOperatingPacks,
  createBusinessArchitectureGraph,
  materializeFilesystemRoster,
} from "@open-agents/operating-packs";
import { connectSandbox, type SandboxState } from "@open-agents/sandbox";
import { sanitizeTraceText } from "@open-agents/traces";
import { createHook, getWorkflowMetadata, sleep } from "workflow";
import { resolveChatSandboxRuntime } from "./chat-sandbox-runtime";
import {
  appendOperatingPackTrace,
  attachOperatingPackWorkflowRun,
  getOperatingPackRun,
  updateOperatingPackRun,
} from "@/lib/db/operating-pack-runs";
import { runHarnessTurnViaApi } from "@/lib/harness-runner/client";
import type { OperatingPackHarnessId } from "@/lib/operating-packs/runtime";
import { resolveOperatingPackWorkflow } from "@/lib/operating-packs/runtime";
import { getOperatingPackApprovalToken } from "@/lib/operating-packs/approval-token";
import {
  type OperatingPackMobileNotificationStatus,
  sendOperatingPackMobileNotification,
} from "@/lib/operating-packs/mobile-notification";
import {
  deleteOperatingPackWorkspaceGrant,
  getOperatingPackWorkspaceGrant,
} from "@/lib/operating-packs/credential-vault";
import {
  getOperatingPackControlToken,
  type OperatingPackControlCheckpoint,
} from "@/lib/operating-packs/control-token";
import { createWorkspaceHarness } from "@open-agents/harness-runner";

export type OperatingPackWorkflowInput = {
  executionId: string;
  workspaceId: string;
  sessionId: string;
  chatId: string;
  userId: string;
  packId: string;
  workflowId: string;
  harnessId: OperatingPackHarnessId;
  prompt: string;
  requestOrigin: string;
  modelId: string;
};

type ApprovalPayload = {
  decision: "approved" | "rejected";
  reason: string;
  actorId: string;
};

type ControlPayload = {
  action: "resume";
  reason: string;
  actorId: string;
};

type PreparedAgent = {
  qualifiedId: string;
  agentId: string;
  instructions: string;
  tools: readonly string[];
};

type PreparedRuntime = {
  sandboxState: SandboxState;
  workingDirectory: string;
  agents: readonly PreparedAgent[];
  requiresApproval: boolean;
  workflowTitle: string;
};

const circleWalletCapabilities = [
  ["circle_login", "agent-wallet.session", false, "read"],
  ["circle_logout", "agent-wallet.session", true, "execute"],
  ["fetch_setup_skill", "agent-wallet.setup", false, "read"],
  ["fetch_sub_skill", "agent-wallet.setup", false, "read"],
  ["circle_list_wallets", "wallet.read", false, "read"],
  ["circle_create_wallet", "wallet.write", true, "execute"],
  ["circle_deploy_wallet", "wallet.write", true, "execute"],
  ["circle_wallet_fund", "wallet.write", true, "execute"],
  ["circle_fund_fiat", "wallet.fiat", true, "execute"],
  ["circle_get_gateway_balance", "wallet.read", false, "read"],
  ["circle_search_services", "service.read", false, "read"],
  ["circle_inspect_service", "service.read", false, "read"],
  ["fetch_service", "service.read", false, "read"],
  ["call_free_service", "service.read", false, "read"],
  ["circle_pay_service", "service.pay", true, "execute"],
  ["circle_gateway_deposit", "wallet.spend", true, "execute"],
] as const satisfies readonly (readonly [string, string, boolean, string])[];

const capabilityRegistry: readonly HarnessMcpCapability[] = [
  {
    name: "knowledge_read",
    server: "custom" as const,
    scopes: ["knowledge.read"],
    requiresApproval: false,
    allowedOperations: ["query"],
  },
  {
    name: "workflow_run",
    server: "custom" as const,
    scopes: ["workflow.run"],
    requiresApproval: false,
    allowedOperations: ["start", "inspect"],
  },
  {
    name: "circle_get_balance",
    server: "bufi-hyper" as const,
    scopes: ["wallet.read"],
    requiresApproval: false,
    allowedOperations: ["read"],
  },
  ...circleWalletCapabilities.map(
    ([name, scope, requiresApproval, operation]) => ({
      name,
      server: "bufi-hyper" as const,
      scopes: [scope],
      requiresApproval,
      allowedOperations: [operation],
    }),
  ),
];

function traceId(executionId: string, sequence: number): string {
  return `${executionId}:${sequence}`;
}

async function markStartedStep(
  input: OperatingPackWorkflowInput,
  workflowRunId: string,
): Promise<void> {
  "use step";
  console.log(`[operating-pack] START execution=${input.executionId}`);
  await Promise.all([
    attachOperatingPackWorkflowRun(input.executionId, workflowRunId),
    updateOperatingPackRun(input.executionId, { status: "running" }),
    appendOperatingPackTrace({
      id: traceId(input.executionId, 1),
      runId: input.executionId,
      workspaceId: input.workspaceId,
      sequence: 1,
      type: "workflow.started",
      summary: `${input.packId}.${input.workflowId} started`,
    }),
  ]);
  console.log(`[operating-pack] STARTED execution=${input.executionId}`);
}

async function prepareRuntimeStep(
  input: OperatingPackWorkflowInput,
): Promise<PreparedRuntime> {
  "use step";
  console.log(`[operating-pack] PREPARE execution=${input.executionId}`);
  const runtime = await resolveChatSandboxRuntime({
    userId: input.userId,
    sessionId: input.sessionId,
  });
  const selection = resolveOperatingPackWorkflow({
    packId: input.packId,
    workflowId: input.workflowId,
  });
  const harness = createWorkspaceHarness({
    harnessId: input.harnessId,
    workspaceId: input.workspaceId,
    teamId: input.workspaceId,
    userId: input.userId,
    sessionId: input.sessionId,
    connectionState: "connected",
    sandboxRef: input.sessionId,
    capabilities: capabilityRegistry,
  });
  const compiled = compileOperatingPacks({
    graph: createBusinessArchitectureGraph({ workspaceId: input.workspaceId }),
    harness,
    manifests: selection.manifests,
  });
  const roster = compileFilesystemRoster(compiled);
  const sandbox = await connectSandbox(runtime.sandboxState);
  const written = await materializeFilesystemRoster({
    writer: sandbox,
    roster,
    root: `.open-agents/runs/${input.executionId}`,
  });
  const selectedAgents = selection.workflow.agentIds.map((agentId) => {
    const candidates = roster.filter((agent) => agent.agentId === agentId);
    const agent = selection.workflow.crossPack
      ? candidates.length === 1
        ? candidates[0]
        : undefined
      : candidates.find((candidate) => candidate.packId === input.packId);
    if (!agent)
      throw new Error(`Compiled workflow agent is unavailable: ${agentId}`);
    const instructions = agent.files.find(
      (file) => file.path === "instructions.md",
    )?.content;
    if (!instructions)
      throw new Error(
        `Compiled workflow agent has no instructions: ${agentId}`,
      );
    return {
      qualifiedId: agent.qualifiedId,
      agentId: agent.agentId,
      instructions,
      tools: agent.tools,
    };
  });
  await appendOperatingPackTrace({
    id: traceId(input.executionId, 2),
    runId: input.executionId,
    workspaceId: input.workspaceId,
    sequence: 2,
    type: "artifact.emitted",
    summary: `Materialized ${selectedAgents.length} agents`,
    data: {
      fileCount: written.length,
      agentIds: selectedAgents.map((a) => a.qualifiedId),
    },
  });
  console.log(`[operating-pack] PREPARED execution=${input.executionId}`);
  return {
    sandboxState: runtime.sandboxState,
    workingDirectory: runtime.workingDirectory,
    agents: selectedAgents,
    requiresApproval: selection.workflow.requiredApproval,
    workflowTitle: selection.workflow.title,
  };
}

async function persistApprovalStep(
  input: OperatingPackWorkflowInput,
  title: string,
): Promise<void> {
  "use step";
  const approvalId = `${input.executionId}:approval`;
  await Promise.all([
    updateOperatingPackRun(input.executionId, {
      status: "awaiting_approval",
      approvalId,
    }),
    appendOperatingPackTrace({
      id: traceId(input.executionId, 3),
      runId: input.executionId,
      workspaceId: input.workspaceId,
      sequence: 3,
      type: "approval.requested",
      summary: `Approval required for ${title}`,
      data: { approvalId },
    }),
  ]);
}

async function notifyMobileStep(
  input: OperatingPackWorkflowInput,
  status: OperatingPackMobileNotificationStatus,
  sequence: number,
): Promise<void> {
  "use step";
  const result = await sendOperatingPackMobileNotification({
    executionId: input.executionId,
    workspaceId: input.workspaceId,
    userId: input.userId,
    packId: input.packId,
    workflowId: input.workflowId,
    status,
  });
  await appendOperatingPackTrace({
    id: traceId(input.executionId, sequence),
    runId: input.executionId,
    workspaceId: input.workspaceId,
    sequence,
    type: result.delivered ? "notification.dispatched" : "notification.skipped",
    summary: result.delivered
      ? `Mobile notification dispatched for ${status}`
      : `Mobile notification ${result.reason ?? "not delivered"}`,
    data: { status, delivered: result.delivered, reason: result.reason },
  });
}

async function persistApprovalDecisionStep(
  input: OperatingPackWorkflowInput,
  payload: ApprovalPayload,
): Promise<void> {
  "use step";
  if (
    !payload ||
    !["approved", "rejected"].includes(payload.decision) ||
    payload.actorId !== input.userId ||
    !payload.reason ||
    payload.reason.length > 1000
  )
    throw new Error("Invalid operating-pack approval payload");
  const approved = payload.decision === "approved";
  await Promise.all([
    updateOperatingPackRun(input.executionId, {
      status: approved ? "approved" : "rejected",
      ...(approved ? {} : { finished: true }),
    }),
    appendOperatingPackTrace({
      id: traceId(input.executionId, 4),
      runId: input.executionId,
      workspaceId: input.workspaceId,
      sequence: 4,
      type: approved ? "approval.approved" : "approval.rejected",
      summary: approved ? "Workflow approved" : "Workflow rejected",
      data: { reason: payload.reason },
    }),
    ...(approved ? [] : [deleteOperatingPackWorkspaceGrant(input.executionId)]),
  ]);
}

async function isPauseRequestedStep(executionId: string): Promise<boolean> {
  "use step";
  const run = await getOperatingPackRun(executionId);
  if (!run) throw new Error("Operating-pack run disappeared");
  return run.status === "pause_requested";
}

async function persistPausedStep(
  input: OperatingPackWorkflowInput,
  checkpoint: OperatingPackControlCheckpoint,
  sequence: number,
): Promise<void> {
  "use step";
  await Promise.all([
    updateOperatingPackRun(input.executionId, {
      status: "paused",
      approvalId: `control:${checkpoint}`,
    }),
    appendOperatingPackTrace({
      id: traceId(input.executionId, sequence),
      runId: input.executionId,
      workspaceId: input.workspaceId,
      sequence,
      type: "workflow.paused",
      summary: `Workflow paused at ${checkpoint.replaceAll("_", " ")}`,
      data: { checkpoint, mode: "next_safe_checkpoint" },
    }),
  ]);
}

async function persistResumedStep(
  input: OperatingPackWorkflowInput,
  checkpoint: OperatingPackControlCheckpoint,
  sequence: number,
  payload: ControlPayload,
): Promise<void> {
  "use step";
  if (
    !payload ||
    payload.action !== "resume" ||
    payload.actorId !== input.userId ||
    !payload.reason ||
    payload.reason.length > 1000
  )
    throw new Error("Invalid operating-pack resume payload");
  await Promise.all([
    updateOperatingPackRun(input.executionId, {
      status: "running",
      approvalId: null,
    }),
    appendOperatingPackTrace({
      id: traceId(input.executionId, sequence),
      runId: input.executionId,
      workspaceId: input.workspaceId,
      sequence,
      type: "workflow.resumed",
      summary: `Workflow resumed at ${checkpoint.replaceAll("_", " ")}`,
      data: { checkpoint, reason: payload.reason },
    }),
  ]);
}

async function pauseAtSafeCheckpoint(
  input: OperatingPackWorkflowInput,
  checkpoint: OperatingPackControlCheckpoint,
  sequence: number,
): Promise<void> {
  if (!(await isPauseRequestedStep(input.executionId))) return;
  const hook = createHook<ControlPayload>({
    token: getOperatingPackControlToken(input.executionId, checkpoint),
  });
  try {
    await persistPausedStep(input, checkpoint, sequence);
    const payload = await hook;
    await persistResumedStep(input, checkpoint, sequence + 1, payload);
  } finally {
    hook.dispose();
  }
}

function responseText(parts: readonly Record<string, unknown>[]): string {
  return sanitizeTraceText(
    parts
      .filter((part) => part.type === "text" && typeof part.text === "string")
      .map((part) => String(part.text))
      .join("\n"),
  );
}

async function runAgentStep(input: {
  workflow: OperatingPackWorkflowInput;
  runtime: Pick<PreparedRuntime, "sandboxState" | "workingDirectory">;
  agent: PreparedAgent;
  index: number;
}) {
  "use step";
  const { workflow, runtime, agent, index } = input;
  console.log(
    `[operating-pack] AGENT START execution=${workflow.executionId} agent=${agent.qualifiedId}`,
  );
  let toolEvents = 0;
  const toolTraceEvents: Array<{
    type: string;
    toolName: string;
    toolCallId: string | null;
    packetHash?: string;
  }> = [];
  const toolNames = new Map<string, string>();
  const sequenceBase = 1000 + index * 200;
  await appendOperatingPackTrace({
    id: traceId(workflow.executionId, sequenceBase),
    runId: workflow.executionId,
    workspaceId: workflow.workspaceId,
    sequence: sequenceBase,
    type: "agent.started",
    agentId: agent.qualifiedId,
    summary: `${agent.qualifiedId} started on ${workflow.harnessId}`,
    data: {
      harnessId: workflow.harnessId,
      toolGrantIds: agent.tools,
    },
  });
  const messageId = `${workflow.executionId}:${agent.agentId}`;
  const workspaceGrant = await getOperatingPackWorkspaceGrant(
    workflow.executionId,
    workflow.workspaceId,
  );
  let result;
  try {
    result = await runHarnessTurnViaApi({
      harnessId: workflow.harnessId,
      sandboxState: runtime.sandboxState,
      workingDirectory: runtime.workingDirectory,
      sessionId: messageId.slice(0, 128),
      messageId,
      messages: [
        {
          id: `${messageId}:request`,
          role: "user",
          parts: [
            {
              type: "text",
              text: `${workflow.prompt}\n\nWork only as ${agent.qualifiedId}. Produce evidence-backed findings for the workflow join.`,
            },
          ],
        },
      ],
      originalMessages: [],
      selectedModelId: workflow.modelId,
      modelId: workflow.modelId,
      requestUrl: workflow.requestOrigin,
      instructions: agent.instructions,
      permissionMode: "allow-reads",
      brokerContext: {
        workspaceId: workflow.workspaceId,
        workspaceGrant,
        executionId: workflow.executionId,
        agentRunId: agent.qualifiedId,
        allowedTools: agent.tools as Array<
          | "knowledge_read"
          | "workflow_run"
          | "circle_get_balance"
          | (typeof circleWalletCapabilities)[number][0]
        >,
      },
      onChunk: (chunk: HarnessUIMessageChunk) => {
        if (String(chunk.type).startsWith("tool-")) {
          toolEvents += 1;
          const toolCallId =
            typeof chunk.toolCallId === "string" ? chunk.toolCallId : null;
          if (toolCallId && typeof chunk.toolName === "string")
            toolNames.set(toolCallId, chunk.toolName);
          const toolName =
            typeof chunk.toolName === "string"
              ? chunk.toolName
              : toolCallId
                ? toolNames.get(toolCallId)
                : undefined;
          if (toolTraceEvents.length < 100 && toolName) {
            const output =
              chunk.output &&
              typeof chunk.output === "object" &&
              !Array.isArray(chunk.output)
                ? (chunk.output as Record<string, unknown>)
                : undefined;
            const packetHash =
              toolName === "knowledge_read" &&
              typeof output?.packetHash === "string" &&
              /^sha256:[a-f0-9]{64}$/.test(output.packetHash)
                ? output.packetHash
                : undefined;
            toolTraceEvents.push({
              type: String(chunk.type),
              toolName,
              toolCallId,
              ...(packetHash ? { packetHash } : {}),
            });
          }
        }
      },
    });
  } catch (error) {
    await appendOperatingPackTrace({
      id: traceId(workflow.executionId, sequenceBase + 198),
      runId: workflow.executionId,
      workspaceId: workflow.workspaceId,
      sequence: sequenceBase + 198,
      type: "agent.failed",
      agentId: agent.qualifiedId,
      summary: `${agent.qualifiedId} failed during harness execution`,
      data: {
        harnessId: workflow.harnessId,
        error: sanitizeTraceText(
          error instanceof Error ? error.message : String(error),
        ),
      },
    });
    throw error;
  }
  const summary = responseText(result.responseMessage.parts);
  await Promise.all([
    ...toolTraceEvents.map((event, eventIndex) =>
      appendOperatingPackTrace({
        id: traceId(workflow.executionId, sequenceBase + eventIndex + 1),
        runId: workflow.executionId,
        workspaceId: workflow.workspaceId,
        sequence: sequenceBase + eventIndex + 1,
        type: "tool.called",
        agentId: agent.qualifiedId,
        summary: `${event.toolName}: ${event.type}`,
        data: event,
      }),
    ),
    appendOperatingPackTrace({
      id: traceId(workflow.executionId, sequenceBase + 199),
      runId: workflow.executionId,
      workspaceId: workflow.workspaceId,
      sequence: sequenceBase + 199,
      type: "agent.completed",
      agentId: agent.qualifiedId,
      summary: summary || `${agent.qualifiedId} completed`,
      data: {
        finishReason: result.finishReason,
        toolEvents,
        toolGrantIds: agent.tools,
        usage: result.usage,
      },
    }),
  ]);
  console.log(
    `[operating-pack] AGENT DONE execution=${workflow.executionId} agent=${agent.qualifiedId}`,
  );
  return {
    agentId: agent.qualifiedId,
    finishReason: result.finishReason,
    summary,
  };
}

async function persistCompletedStep(
  input: OperatingPackWorkflowInput,
  results: readonly Awaited<ReturnType<typeof runAgentStep>>[],
): Promise<void> {
  "use step";
  await Promise.all([
    updateOperatingPackRun(input.executionId, {
      status: "completed",
      result: { agents: results },
      finished: true,
    }),
    appendOperatingPackTrace({
      id: traceId(input.executionId, 10_000),
      runId: input.executionId,
      workspaceId: input.workspaceId,
      sequence: 10_000,
      type: "run.completed",
      summary: `${results.length} agents joined`,
    }),
    deleteOperatingPackWorkspaceGrant(input.executionId),
  ]);
}

async function persistFailedStep(
  input: OperatingPackWorkflowInput,
  error: unknown,
): Promise<void> {
  "use step";
  console.error(`[operating-pack] FAIL execution=${input.executionId}`, error);
  await Promise.all([
    updateOperatingPackRun(input.executionId, {
      status: "failed",
      errorCode: "OPERATING_PACK_EXECUTION_FAILED",
      finished: true,
    }),
    appendOperatingPackTrace({
      id: traceId(input.executionId, 10_001),
      runId: input.executionId,
      workspaceId: input.workspaceId,
      sequence: 10_001,
      type: "run.failed",
      summary: "Operating-pack execution failed",
    }),
    deleteOperatingPackWorkspaceGrant(input.executionId),
  ]);
}

export async function runOperatingPackWorkflow(
  input: OperatingPackWorkflowInput,
) {
  "use workflow";
  const { workflowRunId } = getWorkflowMetadata();
  await markStartedStep(input, workflowRunId);
  try {
    const runtime = await prepareRuntimeStep(input);
    if (runtime.requiresApproval) {
      const hook = createHook<ApprovalPayload>({
        token: getOperatingPackApprovalToken(input.executionId),
      });
      try {
        await persistApprovalStep(input, runtime.workflowTitle);
        await notifyMobileStep(input, "awaiting_approval", 5);
        const decision = await Promise.race([
          hook,
          sleep("7d").then(
            () =>
              ({
                decision: "rejected",
                reason: "Approval window expired",
                actorId: input.userId,
              }) satisfies ApprovalPayload,
          ),
        ]);
        await persistApprovalDecisionStep(input, decision);
        if (decision.decision === "rejected") {
          await notifyMobileStep(input, "rejected", 6);
          return { status: "rejected" as const };
        }
      } finally {
        hook.dispose();
      }
    }
    await pauseAtSafeCheckpoint(input, "before_agents", 100);
    const results = await Promise.all(
      runtime.agents.map((agent, index) =>
        runAgentStep({ workflow: input, runtime, agent, index }),
      ),
    );
    await pauseAtSafeCheckpoint(input, "before_join", 9_000);
    await persistCompletedStep(input, results);
    await notifyMobileStep(input, "completed", 10_002);
    return { status: "completed" as const, results };
  } catch (error) {
    await persistFailedStep(input, error);
    await notifyMobileStep(input, "failed", 10_003);
    throw error;
  }
}
