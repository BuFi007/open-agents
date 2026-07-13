export class WorkflowStepTimeoutError extends Error {
  constructor(
    readonly stepId: string,
    readonly budgetMs: number,
  ) {
    super(`Workflow step timed out: ${stepId} (${budgetMs}ms)`);
    this.name = "WorkflowStepTimeoutError";
  }
}
