import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import {
  evaluateHarnessCertification,
  type HarnessCertificationCheck,
  type HarnessCertificationChecks,
  type HarnessCertificationEvidence,
  type HarnessCertificationTarget,
} from "../packages/certification/harness-certification.ts";

type Observation = {
  command: string;
  startedAtMs: number;
  completedAtMs: number;
  exitCode: number;
  output: string;
};

const targets: HarnessCertificationTarget[] = [
  "hermes",
  "codex",
  "claude-code",
  "open-agents",
  "computer-use",
];
const contractChecks: HarnessCertificationCheck[] = [
  "identityBound",
  "workspaceBound",
  "teamBound",
  "sessionBound",
  "mcpGrantEnforced",
  "ungrantedToolDenied",
  "approvalEventObserved",
  "traceEventObserved",
  "degradedStateHonest",
  "deniedSpendWithoutApproval",
];

function hash(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

async function run(command: string, args: string[], timeoutMs = 90_000) {
  const startedAtMs = Date.now();
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => (output += String(chunk)));
  child.stderr.on("data", (chunk) => (output += String(chunk)));
  const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
  const exitCode = await new Promise<number>((resolve) => {
    child.on("error", (error) => {
      output += `\n${error.message}`;
      resolve(127);
    });
    child.on("close", (code) => resolve(code ?? 1));
  });
  clearTimeout(timer);
  return {
    command: [command, ...args].join(" "),
    startedAtMs,
    completedAtMs: Date.now(),
    exitCode,
    output,
  } satisfies Observation;
}

function evidence(
  id: string,
  target: HarnessCertificationTarget,
  kind: HarnessCertificationEvidence["kind"],
  observation: Observation,
  observedChecks: readonly HarnessCertificationCheck[],
): HarnessCertificationEvidence {
  return {
    id,
    target,
    kind,
    command: observation.command,
    startedAtMs: observation.startedAtMs,
    completedAtMs: observation.completedAtMs,
    exitCode: observation.exitCode,
    outputHash: hash(observation.output),
    observedChecks,
  };
}

async function dispatchOpenAgents(): Promise<Observation> {
  const startedAtMs = Date.now();
  const endpoint =
    process.env.OPEN_AGENTS_INTERNAL_URL ||
    process.env.OPEN_AGENTS_PUBLIC_URL ||
    "https://open-agents-bay.vercel.app";
  const secret = process.env.OPEN_AGENTS_BUFI_INGRESS_SECRET;
  if (!secret) {
    return {
      command: "POST /api/bufi/dispatch (credential absent)",
      startedAtMs,
      completedAtMs: Date.now(),
      exitCode: 78,
      output: "OPEN_AGENTS_BUFI_INGRESS_SECRET is absent",
    };
  }
  try {
    const response = await fetch(new URL("/api/bufi/dispatch", endpoint), {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        blueprint: {
          taskId: "BU-279",
          title: "Read-only live harness certification",
          riskTier: "low",
        },
        repo: {
          owner: "BuFi007",
          name: "open-agents",
          branch: "codex/harness-live-certification",
        },
        prompt:
          "Read-only certification. Do not edit files, push, pay, sign, or call mutating tools. Report the current branch and whether the certification package exists.",
      }),
      signal: AbortSignal.timeout(30_000),
    });
    return {
      command: "POST /api/bufi/dispatch (Bearer redacted)",
      startedAtMs,
      completedAtMs: Date.now(),
      exitCode: response.ok ? 0 : response.status,
      output: `status=${response.status};content-type=${response.headers.get("content-type") ?? "unknown"}`,
    };
  } catch (error) {
    return {
      command: "POST /api/bufi/dispatch (Bearer redacted)",
      startedAtMs,
      completedAtMs: Date.now(),
      exitCode: 1,
      output: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main() {
  const contract = await run("bun", [
    "test",
    "packages/certification/agentic-workspaces.e2e.test.ts",
    "packages/certification/horizontal-erp.e2e.test.ts",
    "packages/harness-runner/workspace-harness.test.ts",
    "packages/agent-wallet",
  ]);
  const hyper = await run("curl", [
    "--silent",
    "--show-error",
    "--fail-with-body",
    "--max-time",
    "20",
    "-X",
    "POST",
    "https://mcp.bu.finance/mcp",
    "-H",
    "content-type: application/json",
    "-H",
    "accept: application/json, text/event-stream",
    "--data",
    '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}',
  ]);
  const hyperPassed =
    hyper.exitCode === 0 &&
    hyper.output.includes("circle_get_balance") &&
    hyper.output.includes("circle_pay_service");

  const handshakes = {
    codex: await run("codex", [
      "exec",
      "--ignore-user-config",
      "--sandbox",
      "read-only",
      "--ephemeral",
      "--color",
      "never",
      "Reply with exactly BUFI_CODEX_HARNESS_OK. Do not call any tools.",
    ]),
    "claude-code": await run("claude", [
      "-p",
      "--safe-mode",
      "--permission-mode",
      "dontAsk",
      "--tools",
      "",
      "--no-session-persistence",
      "--max-budget-usd",
      "0.25",
      "Reply with exactly BUFI_CLAUDE_HARNESS_OK. Do not call any tools.",
    ]),
    hermes: await run("hermes", [
      "--safe-mode",
      "-z",
      "Reply with exactly BUFI_HERMES_HARNESS_OK. Do not call any tools.",
    ]),
    "open-agents": await dispatchOpenAgents(),
    "computer-use": await run("hermes", ["computer-use", "doctor"]),
  } satisfies Record<HarnessCertificationTarget, Observation>;
  const markers: Record<HarnessCertificationTarget, string> = {
    codex: "BUFI_CODEX_HARNESS_OK",
    "claude-code": "BUFI_CLAUDE_HARNESS_OK",
    hermes: "BUFI_HERMES_HARNESS_OK",
    "open-agents": "status=",
    "computer-use": "healthy",
  };
  const handshakePassed = Object.fromEntries(
    targets.map((target) => [
      target,
      handshakes[target].exitCode === 0 &&
        handshakes[target].output.includes(markers[target]),
    ]),
  ) as Record<HarnessCertificationTarget, boolean>;

  const allEvidence: HarnessCertificationEvidence[] = [];
  for (const target of targets) {
    allEvidence.push(
      evidence(
        `contract_${target}`,
        target,
        "contract-test",
        contract,
        contract.exitCode === 0 ? contractChecks : [],
      ),
      evidence(
        `hyper_${target}`,
        target,
        "endpoint-smoke",
        { ...hyper, exitCode: hyperPassed ? 0 : 1 },
        hyperPassed ? ["readOnlyHyperSmoke"] : [],
      ),
      evidence(
        `handshake_${target}`,
        target,
        target === "computer-use" ? "doctor" : "live-handshake",
        handshakes[target],
        handshakePassed[target]
          ? target === "computer-use"
            ? ["sandboxIsolated", "callbackVisible", "computerUseDoctor"]
            : ["sandboxIsolated", "callbackVisible"]
          : [],
      ),
    );
  }

  const checksByTarget = Object.fromEntries(
    targets.map((target) => [
      target,
      {
        identityBound: contract.exitCode === 0,
        workspaceBound: contract.exitCode === 0,
        teamBound: contract.exitCode === 0,
        sessionBound: contract.exitCode === 0,
        mcpGrantEnforced: contract.exitCode === 0,
        ungrantedToolDenied: contract.exitCode === 0,
        approvalEventObserved: contract.exitCode === 0,
        traceEventObserved: contract.exitCode === 0,
        sandboxIsolated: handshakePassed[target],
        callbackVisible: handshakePassed[target],
        degradedStateHonest: contract.exitCode === 0,
        readOnlyHyperSmoke: hyperPassed,
        deniedSpendWithoutApproval: contract.exitCode === 0,
        ...(target === "computer-use"
          ? { computerUseDoctor: handshakePassed[target] }
          : {}),
      } satisfies HarnessCertificationChecks,
    ]),
  ) as Record<HarnessCertificationTarget, HarnessCertificationChecks>;
  const report = evaluateHarnessCertification({
    workspaceId: process.env.BUFI_CERTIFICATION_WORKSPACE_ID ?? "bufi_internal",
    generatedAtMs: Date.now(),
    traceId: `trace_cert_${randomUUID()}`,
    checksByTarget,
    evidence: allEvidence,
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.passed ? 0 : 1;
}

await main();
