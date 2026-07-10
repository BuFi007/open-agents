export type WorkspaceHarnessKind = "hermes" | "codex" | "claude-code";
export type HarnessConnectionState = "connected" | "degraded" | "disconnected";

export type HarnessMcpCapability = {
  name: string;
  server: "bufi-hyper" | "filesystem" | "linear" | "github" | "custom";
  scopes: readonly string[];
  requiresApproval: boolean;
  allowedOperations: readonly string[];
};

export type WorkspaceHarness = {
  harnessId: WorkspaceHarnessKind;
  workspaceId: string;
  teamId: string;
  userId: string;
  sessionId: string;
  connectionState: HarnessConnectionState;
  sandboxRef?: string;
  capabilities: readonly HarnessMcpCapability[];
};

export type HarnessMcpInvocationEvent = {
  workspaceId: string;
  teamId: string;
  userId: string;
  harnessId: WorkspaceHarnessKind;
  sessionId: string;
  capability: string;
  server: HarnessMcpCapability["server"];
  operation: string;
  approvalRequired: boolean;
  auditId: string;
  atMs: number;
};

const ID = /^[a-zA-Z0-9][a-zA-Z0-9:_./-]{1,191}$/;

function requireId(name: string, value: string): void {
  if (!ID.test(value)) throw new Error(`invalid workspace harness ${name}`);
}

function validateCapability(capability: HarnessMcpCapability): HarnessMcpCapability {
  requireId("capability name", capability.name);
  if (!capability.scopes.length) throw new Error("workspace harness capability requires scopes");
  if (!capability.allowedOperations.length) throw new Error("workspace harness capability requires operations");
  for (const scope of capability.scopes) requireId("scope", scope);
  for (const operation of capability.allowedOperations) requireId("operation", operation);
  return { ...capability, scopes: [...new Set(capability.scopes)], allowedOperations: [...new Set(capability.allowedOperations)] };
}

export function createWorkspaceHarness(input: WorkspaceHarness): WorkspaceHarness {
  requireId("workspaceId", input.workspaceId);
  requireId("teamId", input.teamId);
  requireId("userId", input.userId);
  requireId("sessionId", input.sessionId);
  if (input.sandboxRef) requireId("sandboxRef", input.sandboxRef);
  const capabilities = input.capabilities.map(validateCapability);
  if (capabilities.some(capability => capability.server === "bufi-hyper") && input.connectionState !== "connected") throw new Error("bufi-hyper MCP requires a connected harness");
  return { ...input, capabilities };
}

export function createMcpInvocationEvent(harness: WorkspaceHarness, input: { capability: string; operation: string; atMs: number }): HarnessMcpInvocationEvent {
  const valid = createWorkspaceHarness(harness);
  const capability = valid.capabilities.find(candidate => candidate.name === input.capability);
  if (!capability) throw new Error("MCP capability is not granted to this workspace harness");
  if (!capability.allowedOperations.includes(input.operation)) throw new Error("MCP operation is not granted to this workspace harness");
  if (input.atMs <= 0) throw new Error("MCP invocation timestamp is required");
  return {
    workspaceId: valid.workspaceId,
    teamId: valid.teamId,
    userId: valid.userId,
    harnessId: valid.harnessId,
    sessionId: valid.sessionId,
    capability: capability.name,
    server: capability.server,
    operation: input.operation,
    approvalRequired: capability.requiresApproval,
    auditId: `${valid.workspaceId}:${valid.sessionId}:${capability.name}:${input.operation}:${input.atMs}`,
    atMs: input.atMs,
  };
}
