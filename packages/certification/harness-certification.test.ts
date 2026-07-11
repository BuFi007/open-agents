import { describe, expect, it } from "bun:test";
import {
  evaluateHarnessCertification,
  type HarnessCertificationChecks,
  type HarnessCertificationCheck,
  type HarnessCertificationEvidence,
  type HarnessCertificationTarget,
} from "./harness-certification";

const green: HarnessCertificationChecks = {
  identityBound: true,
  workspaceBound: true,
  teamBound: true,
  sessionBound: true,
  mcpGrantEnforced: true,
  ungrantedToolDenied: true,
  approvalEventObserved: true,
  traceEventObserved: true,
  sandboxIsolated: true,
  callbackVisible: true,
  degradedStateHonest: true,
  readOnlyHyperSmoke: true,
  circleWalletReadOnly: true,
  deniedSpendWithoutApproval: true,
  computerUseDoctor: true,
};
const allChecks = Object.keys(green) as HarnessCertificationCheck[];

function evidenceFor(
  target: HarnessCertificationTarget,
): HarnessCertificationEvidence {
  return {
    id: `evidence_${target}`,
    target,
    kind: target === "computer-use" ? "doctor" : "live-handshake",
    command: `certify ${target}`,
    startedAtMs: 1,
    completedAtMs: 2,
    exitCode: 0,
    outputHash:
      "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    observedChecks: allChecks,
  };
}

describe("Harness live certification report contract", () => {
  it("certifies the complete harness matrix and wallet denial boundary", () => {
    const targets: HarnessCertificationTarget[] = [
      "hermes",
      "codex",
      "claude-code",
      "open-agents",
      "computer-use",
    ];
    const checksByTarget = Object.fromEntries(
      targets.map((target) => [target, { ...green }]),
    ) as Record<HarnessCertificationTarget, HarnessCertificationChecks>;
    const report = evaluateHarnessCertification({
      workspaceId: "ws_1",
      generatedAtMs: 100,
      traceId: "trace_certification",
      checksByTarget,
      evidence: targets.map(evidenceFor),
    });
    expect(report.passed).toBe(true);
    expect(report.results).toHaveLength(5);
    expect(
      report.results.every(
        (result) => result.checks.deniedSpendWithoutApproval,
      ),
    ).toBe(true);
    expect(report.reportHash).toStartWith("sha256:");
  });

  it("fails visibly when computer use doctor or MCP denial is missing", () => {
    const checksByTarget = {
      hermes: { ...green },
      codex: { ...green },
      "claude-code": { ...green },
      "open-agents": { ...green, ungrantedToolDenied: false },
      "computer-use": { ...green, computerUseDoctor: false },
    } satisfies Record<HarnessCertificationTarget, HarnessCertificationChecks>;
    const report = evaluateHarnessCertification({
      workspaceId: "ws_1",
      generatedAtMs: 100,
      traceId: "trace_certification",
      checksByTarget,
      evidence: Object.keys(checksByTarget).map((target) =>
        evidenceFor(target as HarnessCertificationTarget),
      ),
    });
    expect(report.passed).toBe(false);
    expect(
      report.results.find((result) => result.target === "open-agents")
        ?.failures,
    ).toContain("ungrantedToolDenied");
    expect(
      report.results.find((result) => result.target === "computer-use")
        ?.failures,
    ).toContain("computerUseDoctor");
  });

  it("rejects an asserted check when no successful evidence observed it", () => {
    const targets: HarnessCertificationTarget[] = [
      "hermes",
      "codex",
      "claude-code",
      "open-agents",
      "computer-use",
    ];
    const checksByTarget = Object.fromEntries(
      targets.map((target) => [target, { ...green }]),
    ) as Record<HarnessCertificationTarget, HarnessCertificationChecks>;
    const evidence = targets.map(evidenceFor);
    evidence[1] = {
      ...evidence[1]!,
      observedChecks: allChecks.filter((name) => name !== "sandboxIsolated"),
    };
    const report = evaluateHarnessCertification({
      workspaceId: "ws_1",
      generatedAtMs: 100,
      traceId: "trace_certification",
      checksByTarget,
      evidence,
    });
    expect(report.passed).toBe(false);
    expect(
      report.results.find((result) => result.target === "codex")?.failures,
    ).toContain("sandboxIsolated");
  });
});
