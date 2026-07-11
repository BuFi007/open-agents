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
export type HarnessCertificationCheck = keyof HarnessCertificationChecks;
export type HarnessCertificationEvidence = {
  id: string;
  target: HarnessCertificationTarget;
  kind: "contract-test" | "live-handshake" | "doctor" | "endpoint-smoke";
  command: string;
  startedAtMs: number;
  completedAtMs: number;
  exitCode: number;
  outputHash: `sha256:${string}`;
  observedChecks: readonly HarnessCertificationCheck[];
};
export type HarnessCertificationResult = {
  target: HarnessCertificationTarget;
  passed: boolean;
  failures: readonly string[];
  checks: HarnessCertificationChecks;
  evidenceIds: readonly string[];
};
export type HarnessCertificationReport = {
  schemaVersion: 1;
  workspaceId: string;
  generatedAtMs: number;
  traceId: string;
  evidence: readonly HarnessCertificationEvidence[];
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
  evidence: readonly HarnessCertificationEvidence[];
}): HarnessCertificationReport {
  const results = (
    Object.entries(input.checksByTarget) as [
      HarnessCertificationTarget,
      HarnessCertificationChecks,
    ][]
  ).map(([target, checks]) => {
    const targetEvidence = input.evidence.filter(
      (item) => item.target === target && item.exitCode === 0,
    );
    const failures = Object.entries(checks)
      .filter(([name, passed]) => {
        if (passed !== true) return true;
        return !targetEvidence.some((item) =>
          item.observedChecks.includes(name as HarnessCertificationCheck),
        );
      })
      .map(([name]) => name);
    if (
      target === "computer-use" &&
      checks.computerUseDoctor !== true &&
      !failures.includes("computerUseDoctor")
    )
      failures.push("computerUseDoctor");
    return {
      target,
      passed: failures.length === 0,
      failures,
      checks,
      evidenceIds: targetEvidence.map((item) => item.id),
    };
  });
  const stable = {
    schemaVersion: 1 as const,
    workspaceId: input.workspaceId,
    generatedAtMs: input.generatedAtMs,
    traceId: input.traceId,
    evidence: input.evidence,
    results,
    passed: results.every((result) => result.passed),
  };
  return {
    ...stable,
    reportHash: `sha256:${createHash("sha256").update(JSON.stringify(stable)).digest("hex")}`,
  };
}
