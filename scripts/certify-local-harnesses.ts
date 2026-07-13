import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import {
  evaluateHarnessCertification,
  type HarnessCertificationCheck,
  type HarnessCertificationChecks,
  type HarnessCertificationEvidence,
  type HarnessCertificationTarget,
} from "../packages/certification/harness-certification.ts";
import {
  findLiveWorkflowOutcome,
  parseDispatchIdentity,
} from "../packages/certification/live-status.ts";
import { CIRCLE_AGENT_WALLET_TOOLS } from "../packages/agent-wallet/index.ts";

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
const requiredHyperTools = CIRCLE_AGENT_WALLET_TOOLS.map((tool) => tool.name);

function hash(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

async function run(
  command: string,
  args: string[],
  timeoutMs = 90_000,
  env: NodeJS.ProcessEnv = process.env,
) {
  const startedAtMs = Date.now();
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env,
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

async function certifyCircleWalletReadOnly(): Promise<Observation> {
  const startedAtMs = Date.now();
  const chain = process.env.CIRCLE_CERTIFICATION_CHAIN ?? "BASE";
  const status = await run("circle", [
    "wallet",
    "status",
    "--type",
    "agent",
    "--output",
    "json",
  ]);
  const wallets = await run("circle", [
    "wallet",
    "list",
    "--chain",
    chain,
    "--type",
    "agent",
    "--output",
    "json",
  ]);
  try {
    const statusJson = JSON.parse(status.output) as {
      data?: { mainnet?: { tokenStatus?: string } };
    };
    const walletsJson = JSON.parse(wallets.output) as {
      data?: { wallets?: Array<{ address?: string }> };
    };
    const address = walletsJson.data?.wallets?.[0]?.address;
    if (
      status.exitCode !== 0 ||
      wallets.exitCode !== 0 ||
      statusJson.data?.mainnet?.tokenStatus !== "VALID" ||
      !address
    ) {
      throw new Error(
        "agent wallet authentication or wallet inventory unavailable",
      );
    }
    const balance = await run("circle", [
      "wallet",
      "balance",
      "--address",
      address,
      "--chain",
      chain,
      "--output",
      "json",
    ]);
    return {
      command: `circle wallet status + list + balance --chain ${chain} (address redacted)`,
      startedAtMs,
      completedAtMs: Date.now(),
      exitCode: balance.exitCode,
      output: [
        `status=${status.exitCode}`,
        `wallets=${wallets.exitCode}`,
        `balance=${balance.exitCode}`,
        `walletCount=${walletsJson.data?.wallets?.length ?? 0}`,
        `balanceHash=${hash(balance.output)}`,
      ].join(";"),
    };
  } catch (error) {
    return {
      command: `circle wallet status + list + balance --chain ${chain} (address redacted)`,
      startedAtMs,
      completedAtMs: Date.now(),
      exitCode: 1,
      output: error instanceof Error ? error.message : String(error),
    };
  }
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
    const dispatchIdentity = parseDispatchIdentity(
      await response.json().catch(() => null),
    );
    if (!response.ok || !dispatchIdentity) {
      return {
        command: "POST /api/bufi/dispatch (Bearer redacted)",
        startedAtMs,
        completedAtMs: Date.now(),
        exitCode: response.ok ? 1 : response.status,
        output: `dispatch-status=${response.status};identity=${dispatchIdentity ? "valid" : "invalid"}`,
      };
    }
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      const statusResponse = await fetch(
        new URL(
          `/api/bufi/sessions/recent?since=${startedAtMs - 60_000}`,
          endpoint,
        ),
        {
          headers: { authorization: `Bearer ${secret}` },
          signal: AbortSignal.timeout(10_000),
        },
      );
      const outcome = findLiveWorkflowOutcome(
        await statusResponse.json().catch(() => null),
        dispatchIdentity,
      );
      if (outcome !== "pending") {
        return {
          command:
            "POST /api/bufi/dispatch + poll terminal workflow (Bearer redacted)",
          startedAtMs,
          completedAtMs: Date.now(),
          exitCode: outcome === "completed" ? 0 : 1,
          output: `dispatch-status=${response.status};workflow=${outcome}`,
        };
      }
    }
    return {
      command:
        "POST /api/bufi/dispatch + poll terminal workflow (Bearer redacted)",
      startedAtMs,
      completedAtMs: Date.now(),
      exitCode: 124,
      output: `dispatch-status=${response.status};workflow=pending-timeout`,
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
  const hyperToolPresent = (name: string) =>
    new RegExp(`\\"name\\"\\s*:\\s*\\"${name}\\"`).test(hyper.output);
  const hyperToolsPresent = requiredHyperTools.filter(hyperToolPresent);
  const hyperPassed =
    hyper.exitCode === 0 &&
    hyperToolsPresent.length === requiredHyperTools.length;
  const circleWallet = await certifyCircleWalletReadOnly();
  const circleWalletPassed = circleWallet.exitCode === 0;

  const claudeGatewayKey = process.env.AI_GATEWAY_API_KEY;
  const claudeEnvironment = claudeGatewayKey
    ? {
        ...process.env,
        ANTHROPIC_BASE_URL: "https://ai-gateway.vercel.sh",
        ANTHROPIC_AUTH_TOKEN: claudeGatewayKey,
        ANTHROPIC_API_KEY: "",
      }
    : process.env;

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
    "claude-code": await run(
      "claude",
      [
        "--bare",
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
      ],
      90_000,
      claudeEnvironment,
    ),
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
    "open-agents": "workflow=completed",
    "computer-use": "healthy",
  };
  const handshakePassed = Object.fromEntries(
    targets.map((target) => [
      target,
      handshakes[target].exitCode === 0 &&
        handshakes[target].output.includes(markers[target]),
    ]),
  ) as Record<HarnessCertificationTarget, boolean>;

  const allEvidence: HarnessCertificationEvidence[] = [
    evidence(
      "contract_open_agents",
      "open-agents",
      "contract-test",
      contract,
      contract.exitCode === 0 ? contractChecks : [],
    ),
    evidence(
      "hyper_open_agents",
      "open-agents",
      "endpoint-smoke",
      {
        ...hyper,
        command: `${hyper.command} (Circle tools ${hyperToolsPresent.length}/${requiredHyperTools.length})`,
        exitCode: hyperPassed ? 0 : 1,
      },
      hyperPassed ? ["readOnlyHyperSmoke"] : [],
    ),
    evidence(
      "circle_wallet_open_agents",
      "open-agents",
      "endpoint-smoke",
      circleWallet,
      circleWalletPassed ? ["circleWalletReadOnly"] : [],
    ),
  ];
  for (const target of targets) {
    allEvidence.push(
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
        identityBound: target === "open-agents" && contract.exitCode === 0,
        workspaceBound: target === "open-agents" && contract.exitCode === 0,
        teamBound: target === "open-agents" && contract.exitCode === 0,
        sessionBound: target === "open-agents" && contract.exitCode === 0,
        mcpGrantEnforced: target === "open-agents" && contract.exitCode === 0,
        ungrantedToolDenied:
          target === "open-agents" && contract.exitCode === 0,
        approvalEventObserved:
          target === "open-agents" && contract.exitCode === 0,
        traceEventObserved: target === "open-agents" && contract.exitCode === 0,
        sandboxIsolated: target === "open-agents" && handshakePassed[target],
        callbackVisible: target === "open-agents" && handshakePassed[target],
        degradedStateHonest:
          target === "open-agents" && contract.exitCode === 0,
        readOnlyHyperSmoke: target === "open-agents" && hyperPassed,
        circleWalletReadOnly: target === "open-agents" && circleWalletPassed,
        deniedSpendWithoutApproval:
          target === "open-agents" && contract.exitCode === 0,
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
