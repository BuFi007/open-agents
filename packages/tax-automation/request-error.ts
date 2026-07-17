export class TaxAutomationRequestError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(`Tax Automation Engine request failed: ${code}`);
    this.name = "TaxAutomationRequestError";
  }
}
