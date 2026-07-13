export class WorkflowApprovalRejectedError extends Error {
  constructor(
    readonly approvalId: string,
    readonly stepId: string,
  ) {
    super(`Workflow approval rejected: ${approvalId}`);
    this.name = "WorkflowApprovalRejectedError";
  }
}
