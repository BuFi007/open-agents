export interface AgentWorkflowInput {
  readonly goal: string;
  readonly workspaceId: string;
}

export interface AgentWorkflowStep {
  readonly id: string;
  readonly capability: string;
  readonly dependsOn: readonly string[];
}

export interface AgentWorkflowPlan {
  readonly workflowId: string;
  readonly steps: readonly AgentWorkflowStep[];
}

export interface FilesystemAgentWorkflow {
  readonly id: string;
  readonly plan: (input: AgentWorkflowInput) => AgentWorkflowPlan;
}

export interface FilesystemAgentDefinition {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly instructions: URL;
  readonly tools: readonly string[];
  readonly workflow: FilesystemAgentWorkflow;
}
