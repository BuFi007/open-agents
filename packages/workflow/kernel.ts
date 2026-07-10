export type WorkflowStep<T = unknown> = {
  id: string;
  agentId: string;
  dependsOn?: readonly string[];
  budgetMs?: number;
  maxAttempts?: number;
  run: (context: {
    workspaceId: string;
    input: T;
    signal: AbortSignal;
  }) => Promise<unknown>;
};

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
    | "step.started"
    | "step.succeeded"
    | "step.failed"
    | "workflow.cancelled"
    | "workflow.completed";
  runId: string;
  stepId?: string;
  attempt?: number;
  at: number;
};

export type WorkflowRun = {
  runId: string;
  workspaceId: string;
  status: "running" | "completed" | "failed" | "cancelled";
  results: Readonly<Record<string, unknown>>;
  events: readonly WorkflowEvent[];
};

export type WorkflowStore = {
  append(runId: string, event: WorkflowEvent): Promise<void>;
  save(run: WorkflowRun): Promise<void>;
};

function validate<T>(definition: WorkflowDefinition<T>): void {
  if (!definition.id || !definition.workspaceId || definition.budgetMs <= 0)
    throw new Error("Invalid workflow definition");
  const ids = new Set<string>();
  for (const step of definition.steps) {
    if (!step.id || ids.has(step.id))
      throw new Error(`Duplicate workflow step: ${step.id}`);
    ids.add(step.id);
    for (const dependency of step.dependsOn ?? [])
      if (!definition.steps.some((candidate) => candidate.id === dependency))
        throw new Error(`Unknown dependency: ${dependency}`);
  }
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

export async function runWorkflow<T>(
  definition: WorkflowDefinition<T>,
  options: { store: WorkflowStore; signal?: AbortSignal; runId?: string },
): Promise<WorkflowRun> {
  const workflow = createWorkflow(definition);
  const runId =
    options.runId ?? `${workflow.workspaceId}:${workflow.id}:${Date.now()}`;
  const started = Date.now();
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  const events: WorkflowEvent[] = [];
  const results: Record<string, unknown> = {};
  const emit = async (event: WorkflowEvent) => {
    events.push(event);
    await options.store.append(runId, event);
  };
  await emit({ type: "workflow.started", runId, at: started });
  let status: WorkflowRun["status"] = "running";
  try {
    const pending = new Set(workflow.steps.map((step) => step.id));
    while (pending.size) {
      if (
        controller.signal.aborted ||
        Date.now() - started >= workflow.budgetMs
      ) {
        status = "cancelled";
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
              const result = await step.run({
                workspaceId: workflow.workspaceId,
                input: workflow.input,
                signal: controller.signal,
              });
              await emit({
                type: "step.succeeded",
                runId,
                stepId: step.id,
                attempt,
                at: Date.now(),
              });
              return [step.id, result] as const;
            } catch (error) {
              await emit({
                type: "step.failed",
                runId,
                stepId: step.id,
                attempt,
                at: Date.now(),
              });
              if (attempt === attempts) throw error;
            }
          }
          throw new Error("unreachable");
        }),
      );
      for (const [id, result] of outcomes) {
        results[id] = result;
        pending.delete(id);
      }
    }
    if (status === "running") {
      status = "completed";
      await emit({ type: "workflow.completed", runId, at: Date.now() });
    }
  } catch (error) {
    status = controller.signal.aborted ? "cancelled" : "failed";
    if (status === "cancelled")
      await emit({ type: "workflow.cancelled", runId, at: Date.now() });
    else throw error;
  } finally {
    options.signal?.removeEventListener("abort", abort);
  }
  const run = {
    runId,
    workspaceId: workflow.workspaceId,
    status,
    results,
    events,
  } satisfies WorkflowRun;
  await options.store.save(run);
  return run;
}
