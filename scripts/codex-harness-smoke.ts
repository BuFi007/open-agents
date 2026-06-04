/**
 * Run one Codex harness turn against an existing caller-owned Open Agents
 * sandbox. This validates bridge startup, AI Gateway auth, and detach cleanup
 * without routing through the chat workflow.
 *
 * Usage:
 *   pnpm harness:smoke:codex -- --sandbox session_<session-id>
 *   pnpm harness:smoke:codex -- --sandbox session_<session-id> --prompt "Reply with the current working directory."
 */

import { randomUUID } from "node:crypto";
import { codex } from "@agent-harness-experimental/adapter-codex";
import { createVercelSandboxBackend } from "@agent-harness-experimental/sandbox-vercel";
import {
  createAgentSession,
  ensureGatewayApiKeyEnv,
  provideSandbox,
} from "agent-harness-experimental";
import { connectVercelSandbox } from "@open-agents/sandbox/vercel";

const DEFAULT_PROMPT =
  "Reply with exactly: codex harness smoke ok. Do not call tools.";

interface CliOptions {
  sandboxName: string;
  prompt: string;
  model?: string;
}

function printUsage() {
  console.log(`Usage:
  pnpm harness:smoke:codex -- --sandbox session_<session-id>
  pnpm harness:smoke:codex -- --sandbox session_<session-id> --prompt "Reply with the current working directory."

Options:
  --sandbox <name>   Existing caller-owned Open Agents sandbox name
  --prompt <text>    Prompt for the Codex turn
  --model <id>       Optional Codex model override
  --help             Show this message`);
}

function requireOptionValue(
  argv: string[],
  index: number,
  option: string,
): string {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${option}.`);
  }
  return value;
}

function parseArgs(argv: string[]): CliOptions | { help: true } {
  let sandboxName: string | undefined;
  let prompt = DEFAULT_PROMPT;
  let model: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      return { help: true };
    }
    if (arg === "--sandbox") {
      sandboxName = requireOptionValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--prompt") {
      prompt = requireOptionValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--model") {
      model = requireOptionValue(argv, index, arg);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!sandboxName) {
    throw new Error(
      "Pass --sandbox <name> for an existing Open Agents sandbox.",
    );
  }

  return { sandboxName, prompt, model };
}

async function ensureCodexAuth() {
  if (
    process.env.AI_GATEWAY_API_KEY ||
    process.env.VERCEL_OIDC_TOKEN ||
    process.env.CODEX_API_KEY ||
    process.env.OPENAI_API_KEY
  ) {
    return;
  }

  const gatewayKey = await ensureGatewayApiKeyEnv();
  if (!gatewayKey) {
    throw new Error(
      "Codex auth is unavailable. Set AI_GATEWAY_API_KEY, VERCEL_OIDC_TOKEN, CODEX_API_KEY, or OPENAI_API_KEY.",
    );
  }
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if ("help" in parsed) {
    printUsage();
    return;
  }

  await ensureCodexAuth();

  const sandbox = await connectVercelSandbox({
    sandboxName: parsed.sandboxName,
    resume: true,
    ports: [5001],
  });
  const backend = createVercelSandboxBackend();
  const provided = provideSandbox({
    backend,
    session: sandbox.toAgentHarnessWorkspace(),
    bridgePorts: [5001],
  });
  const sessionId = `codex-smoke-${randomUUID()}`;
  const agent = createAgentSession({
    adapter: codex(parsed.model ? { model: parsed.model } : undefined),
    sessionId,
    sandbox: {
      mode: "provided",
      provided,
      runtimeSetup: "refresh",
      workingDirectory: {
        kind: "path",
        path: sandbox.workingDirectory,
      },
    },
  });

  try {
    const result = await agent.generate(parsed.prompt);
    console.log(
      JSON.stringify(
        {
          ok: true,
          sandboxName: parsed.sandboxName,
          sessionId,
          status: result.status,
          text: result.text,
          pending: result.pending,
          resumeState: agent.session.exportState(),
        },
        null,
        2,
      ),
    );
  } finally {
    await agent.close("detach");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
