import { createHash } from "node:crypto";

export type HarnessCertificationTarget =
  | "hermes"
  | "codex"
  | "claude-code"
  | "open-agents"
  | "computer-use";
export type HarnessCertificationChecks = {
  identityBound: boolean;
  workspaceBound: boolean;
  teamBound: boolean;
  sessionBound: boolean;
  mcpGrantEnforced: boolean;
  ungrantedToolDenied: boolean;
  approvalEventObserved: boolean;
  traceEventObserved: boolean;
  sandboxIsolated: boolean;
  callbackVisible: boolean;
  degradedStateHonest: boolean;
  readOnlyHyperSmoke: boolean;
  deniedSpendWithoutApproval: boolean;
  computerUseDoctor?: boolean;
};
export type HarnessCertificationResult = {
  target: HarnessCertificationTarget;
  passed: boolean;
  failures: readonly string[];
  checks: HarnessCertificationChecks;
};
export type HarnessCertificationReport = {
  schemaVersion: 1;
  workspaceId: string;
  generatedAtMs: number;
  traceId: string;
  results: readonly HarnessCertificationResult[];
  passed: boolean;
  reportHash: string;
};

export function evaluateHarnessCertification(input: {
  workspaceId: string;
  generatedAtMs: number;
  traceId: string;
  checksByTarget: Readonly<
    Record<HarnessCertificationTarget, HarnessCertificationChecks>
  >;
}): HarnessCertificationReport {
  const results = (
    Object.entries(input.checksByTarget) as [
      HarnessCertificationTarget,
      HarnessCertificationChecks,
    ][]
  ).map(([target, checks]) => {
    const failures = Object.entries(checks)
      .filter(([, passed]) => passed !== true)
      .map(([name]) => name);
    if (
      target === "computer-use" &&
      checks.computerUseDoctor !== true &&
      !failures.includes("computerUseDoctor")
    )
      failures.push("computerUseDoctor");
    return { target, passed: failures.length === 0, failures, checks };
  });
  const stable = {
    schemaVersion: 1 as const,
    workspaceId: input.workspaceId,
    generatedAtMs: input.generatedAtMs,
    traceId: input.traceId,
    results,
    passed: results.every((result) => result.passed),
  };
  return {
    ...stable,
    reportHash: `sha256:${createHash("sha256").update(JSON.stringify(stable)).digest("hex")}`,
  };
}
