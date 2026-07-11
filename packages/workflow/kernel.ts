import { WorkflowApprovalRejectedError } from "./approval-rejected-error";
import { WorkflowStepTimeoutError } from "./step-timeout-error";

type WorkflowStepBase = {
  id: string;
  agentId: string;
  dependsOn?: readonly string[];
  budgetMs?: number;
  maxAttempts?: number;
  retryBackoffMs?: number;
};

export type WorkflowTaskStep<T = unknown> = WorkflowStepBase & {
  kind?: "task";
  run: (context: {
    workspaceId: string;
    input: T;
    signal: AbortSignal;
  }) => Promise<unknown>;
};

export type WorkflowApprovalStep = WorkflowStepBase & {
  kind: "approval";
  approval: {
    approvalId: string;
    capability: string;
    summary: string;
    expiresAtMs?: number;
  };
};

export type WorkflowStep<T = unknown> =
  | WorkflowTaskStep<T>
  | WorkflowApprovalStep;

export type WorkflowDefinition<T = unknown> = {
  id: string;
  workspaceId: string;
  input: T;
  steps: readonly WorkflowStep<T>[];
  budgetMs: number;
};

export type WorkflowEvent = {
  type:
    | "workflow.started"
    | "workflow.resumed"
    | "step.started"
    | "step.succeeded"
    | "step.failed"
    | "approval.requested"
    | "approval.approved"
    | "approval.rejected"
    | "workflow.failed"
    | "workflow.cancelled"
    | "workflow.completed";
  runId: string;
  stepId?: string;
  attempt?: number;
  approvalId?: string;
  capability?: string;
  at: number;
};

export type WorkflowRun = {
  runId: string;
  workflowId: string;
  workspaceId: string;
  status: "running" | "paused" | "completed" | "failed" | "cancelled";
  results: Readonly<Record<string, unknown>>;
  events: readonly WorkflowEvent[];
};

export type WorkflowStore = {
  append(runId: string, event: WorkflowEvent): Promise<void>;
  save(run: WorkflowRun): Promise<void>;
  load?(runId: string): Promise<WorkflowRun | null>;
};

export type ApprovalDecision = "pending" | "approved" | "rejected";

export type WorkflowExecutionOptions = {
  store: WorkflowStore;
  signal?: AbortSignal;
  runId?: string;
  resolveApproval?: (input: {
    workspaceId: string;
    workflowId: string;
    runId: string;
    stepId: string;
    approval: WorkflowApprovalStep["approval"];
  }) => Promise<ApprovalDecision>;
};

function validate<T>(definition: WorkflowDefinition<T>): void {
  if (!definition.id || !definition.workspaceId || definition.budgetMs <= 0)
    throw new Error("Invalid workflow definition");
  const ids = new Set<string>();
  for (const step of definition.steps) {
    if (!step.id || ids.has(step.id))
      throw new Error(`Duplicate workflow step: ${step.id}`);
    ids.add(step.id);
    if (step.budgetMs !== undefined && step.budgetMs <= 0)
      throw new Error(`Invalid workflow step budget: ${step.id}`);
    if (step.maxAttempts !== undefined && step.maxAttempts < 1)
      throw new Error(`Invalid workflow step attempts: ${step.id}`);
    if (step.retryBackoffMs !== undefined && step.retryBackoffMs < 0)
      throw new Error(`Invalid workflow retry backoff: ${step.id}`);
    if (step.kind === "approval") {
      const approval = step.approval;
      if (
        !approval.approvalId ||
        !approval.capability ||
        !approval.summary ||
        (approval.expiresAtMs !== undefined && approval.expiresAtMs <= 0)
      )
        throw new Error(`Invalid workflow approval step: ${step.id}`);
    } else if (typeof step.run !== "function") {
      throw new Error(`Workflow task is missing run(): ${step.id}`);
    }
    for (const dependency of step.dependsOn ?? [])
      if (!definition.steps.some((candidate) => candidate.id === dependency))
        throw new Error(`Unknown dependency: ${dependency}`);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (stepId: string) => {
    if (visiting.has(stepId)) throw new Error("Workflow dependency cycle");
    if (visited.has(stepId)) return;
    visiting.add(stepId);
    const step = definition.steps.find((candidate) => candidate.id === stepId);
    for (const dependency of step?.dependsOn ?? []) visit(dependency);
    visiting.delete(stepId);
    visited.add(stepId);
  };
  for (const step of definition.steps) visit(step.id);
}

export function createWorkflow<T>(
  definition: WorkflowDefinition<T>,
): WorkflowDefinition<T> {
  validate(definition);
  return {
    ...definition,
    steps: definition.steps.map((step) => ({
      ...step,
      dependsOn: [...(step.dependsOn ?? [])],
    })),
  };
}

function waitForRetry(delayMs: number, signal: AbortSignal): Promise<void> {
  if (delayMs <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const finish = () => {
      signal.removeEventListener("abort", abort);
      resolve();
    };
    const timer = setTimeout(finish, delayMs);
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(signal.reason ?? new Error("Workflow cancelled"));
    };
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}

async function runTaskWithinBudget<T>(input: {
  step: WorkflowTaskStep<T>;
  workspaceId: string;
  workflowInput: T;
  signal: AbortSignal;
  remainingWorkflowBudgetMs: number;
}): Promise<unknown> {
  const budgetMs = Math.min(
    input.step.budgetMs ?? input.remainingWorkflowBudgetMs,
    input.remainingWorkflowBudgetMs,
  );
  if (budgetMs <= 0)
    throw new WorkflowStepTimeoutError(input.step.id, budgetMs);

  const stepController = new AbortController();
  const abortFromWorkflow = () => stepController.abort(input.signal.reason);
  if (input.signal.aborted) abortFromWorkflow();
  else
    input.signal.addEventListener("abort", abortFromWorkflow, { once: true });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      stepController.abort(
        new WorkflowStepTimeoutError(input.step.id, budgetMs),
      );
      reject(new WorkflowStepTimeoutError(input.step.id, budgetMs));
    }, budgetMs);
  });
  let rejectCancellation: (() => void) | undefined;
  const cancelled = new Promise<never>((_resolve, reject) => {
    rejectCancellation = () =>
      reject(input.signal.reason ?? new Error("Workflow cancelled"));
    if (input.signal.aborted) rejectCancellation();
    else
      input.signal.addEventListener("abort", rejectCancellation, {
        once: true,
      });
  });

  try {
    return await Promise.race([
      input.step.run({
        workspaceId: input.workspaceId,
        input: input.workflowInput,
        signal: stepController.signal,
      }),
      timeout,
      cancelled,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    input.signal.removeEventListener("abort", abortFromWorkflow);
    if (rejectCancellation)
      input.signal.removeEventListener("abort", rejectCancellation);
  }
}

function hasEvent(
  events: readonly WorkflowEvent[],
  type: WorkflowEvent["type"],
  stepId?: string,
): boolean {
  return events.some(
    (event) =>
      event.type === type && (stepId === undefined || event.stepId === stepId),
  );
}

async function executeWorkflow<T>(input: {
  workflow: WorkflowDefinition<T>;
  options: WorkflowExecutionOptions;
  runId: string;
  previous?: WorkflowRun;
}): Promise<WorkflowRun> {
  const { workflow, options, runId, previous } = input;
  const activeSegmentStartedAt = Date.now();
  const controller = new AbortController();
  const abort = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) controller.abort(options.signal.reason);
  options.signal?.addEventListener("abort", abort, { once: true });
  const events: WorkflowEvent[] = [...(previous?.events ?? [])];
  const results: Record<string, unknown> = { ...previous?.results };
  const emit = async (event: WorkflowEvent) => {
    events.push(event);
    await options.store.append(runId, event);
  };
  await emit({
    type: previous ? "workflow.resumed" : "workflow.started",
    runId,
    at: activeSegmentStartedAt,
  });
  let status: WorkflowRun["status"] = "running";
  let caughtError: unknown;

  try {
    const pending = new Set(
      workflow.steps
        .map((step) => step.id)
        .filter((stepId) => !(stepId in results)),
    );
    while (pending.size) {
      const elapsed = Date.now() - activeSegmentStartedAt;
      if (controller.signal.aborted || elapsed >= workflow.budgetMs) {
        controller.abort(new Error("Workflow budget exhausted"));
        status = "cancelled";
        if (!hasEvent(events, "workflow.cancelled"))
          await emit({ type: "workflow.cancelled", runId, at: Date.now() });
        break;
      }
      const ready = workflow.steps.filter(
        (step) =>
          pending.has(step.id) &&
          (step.dependsOn ?? []).every((id) => id in results),
      );
      if (!ready.length)
        throw new Error("Workflow dependency cycle or failed prerequisite");

      const outcomes = await Promise.all(
        ready.map(async (step) => {
          if (step.kind === "approval") {
            const decision =
              step.approval.expiresAtMs !== undefined &&
              Date.now() >= step.approval.expiresAtMs
                ? "rejected"
                : ((await options.resolveApproval?.({
                    workspaceId: workflow.workspaceId,
                    workflowId: workflow.id,
                    runId,
                    stepId: step.id,
                    approval: step.approval,
                  })) ?? "pending");
            if (
              !(["pending", "approved", "rejected"] as const).includes(decision)
            )
              throw new Error(`Invalid approval decision: ${String(decision)}`);
            if (decision === "pending") {
              if (!hasEvent(events, "approval.requested", step.id))
                await emit({
                  type: "approval.requested",
                  runId,
                  stepId: step.id,
                  approvalId: step.approval.approvalId,
                  capability: step.approval.capability,
                  at: Date.now(),
                });
              return { kind: "paused" as const, stepId: step.id };
            }
            if (decision === "rejected") {
              await emit({
                type: "approval.rejected",
                runId,
                stepId: step.id,
                approvalId: step.approval.approvalId,
                capability: step.approval.capability,
                at: Date.now(),
              });
              throw new WorkflowApprovalRejectedError(
                step.approval.approvalId,
                step.id,
              );
            }
            await emit({
              type: "approval.approved",
              runId,
              stepId: step.id,
              approvalId: step.approval.approvalId,
              capability: step.approval.capability,
              at: Date.now(),
            });
            return {
              kind: "result" as const,
              stepId: step.id,
              result: {
                approvalId: step.approval.approvalId,
                decision: "approved" as const,
              },
            };
          }

          const attempts = Math.max(1, step.maxAttempts ?? 1);
          for (let attempt = 1; attempt <= attempts; attempt++) {
            await emit({
              type: "step.started",
              runId,
              stepId: step.id,
              attempt,
              at: Date.now(),
            });
            try {
              const remainingWorkflowBudgetMs =
                workflow.budgetMs - (Date.now() - activeSegmentStartedAt);
              const result = await runTaskWithinBudget({
                step,
                workspaceId: workflow.workspaceId,
                workflowInput: workflow.input,
                signal: controller.signal,
                remainingWorkflowBudgetMs,
              });
              await emit({
                type: "step.succeeded",
                runId,
                stepId: step.id,
                attempt,
                at: Date.now(),
              });
              return { kind: "result" as const, stepId: step.id, result };
            } catch (error) {
              await emit({
                type: "step.failed",
                runId,
                stepId: step.id,
                attempt,
                at: Date.now(),
              });
              if (controller.signal.aborted || attempt === attempts)
                throw error;
              const baseBackoffMs = step.retryBackoffMs ?? 100;
              const backoffMs = Math.min(
                baseBackoffMs * 2 ** Math.max(0, attempt - 1),
                30_000,
              );
              await waitForRetry(backoffMs, controller.signal);
            }
          }
          throw new Error("unreachable");
        }),
      );

      let shouldPause = false;
      for (const outcome of outcomes) {
        if (outcome.kind === "paused") {
          shouldPause = true;
          continue;
        }
        results[outcome.stepId] = outcome.result;
        pending.delete(outcome.stepId);
      }
      if (shouldPause) {
        status = "paused";
        break;
      }
    }
    if (status === "running") {
      status = "completed";
      await emit({ type: "workflow.completed", runId, at: Date.now() });
    }
  } catch (error) {
    caughtError = error;
    status = controller.signal.aborted ? "cancelled" : "failed";
    if (status === "cancelled") {
      if (!hasEvent(events, "workflow.cancelled"))
        await emit({ type: "workflow.cancelled", runId, at: Date.now() });
    } else {
      await emit({ type: "workflow.failed", runId, at: Date.now() });
    }
  } finally {
    options.signal?.removeEventListener("abort", abort);
  }

  const run = {
    runId,
    workflowId: workflow.id,
    workspaceId: workflow.workspaceId,
    status,
    results,
    events,
  } satisfies WorkflowRun;
  await options.store.save(run);
  if (caughtError) throw caughtError;
  return run;
}

export async function runWorkflow<T>(
  definition: WorkflowDefinition<T>,
  options: WorkflowExecutionOptions,
): Promise<WorkflowRun> {
  const workflow = createWorkflow(definition);
  const runId =
    options.runId ?? `${workflow.workspaceId}:${workflow.id}:${Date.now()}`;
  if (options.store.load && (await options.store.load(runId)))
    throw new Error(`Workflow run already exists: ${runId}`);
  return executeWorkflow({ workflow, options, runId });
}

export async function resumeWorkflow<T>(
  definition: WorkflowDefinition<T>,
  options: WorkflowExecutionOptions & { runId: string },
): Promise<WorkflowRun> {
  const workflow = createWorkflow(definition);
  if (!options.store.load)
    throw new Error("Workflow store does not support durable resume");
  const previous = await options.store.load(options.runId);
  if (!previous) throw new Error(`Workflow run not found: ${options.runId}`);
  if (
    previous.workflowId !== workflow.id ||
    previous.workspaceId !== workflow.workspaceId
  )
    throw new Error("Workflow resume definition mismatch");
  if (previous.status === "completed") return previous;
  if (previous.status !== "paused")
    throw new Error(`Workflow run is not resumable: ${previous.status}`);
  return executeWorkflow({
    workflow,
    options,
    runId: options.runId,
    previous,
  });
}
