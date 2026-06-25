import { createHash } from "node:crypto";
import { Sandbox as VercelSandboxSDK } from "@vercel/sandbox";
import { connectSandbox, type SandboxConnectConfig } from "../factory.ts";
import type { SnapshotSandbox } from "./snapshot-refresh.ts";

const VERCEL_SNAPSHOT_TEMPLATE_CONTRACT_VERSION = 1;

type SnapshotSandboxConnector = (
  config: SandboxConnectConfig,
) => Promise<SnapshotSandbox>;

export interface EnsureVercelSnapshotTemplateOptions {
  templateName: string;
  sandboxTimeoutMs: number;
  baseSnapshotId?: string;
  ports?: number[];
  env?: Record<string, string>;
  prepare?: (sandbox: SnapshotSandbox) => Promise<void>;
  log?: (message: string) => void;
}

export interface EnsureVercelSnapshotTemplateResult {
  templateName: string;
  snapshotId: string;
  created: boolean;
}

interface VercelSnapshotTemplateDependencies {
  connectSandbox?: SnapshotSandboxConnector;
  resolveSnapshotId?: (templateName: string) => Promise<string | undefined>;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isSandboxNotFoundError(error: unknown): boolean {
  const message = toErrorMessage(error).toLowerCase();
  return message.includes("status code 404") || message.includes("not found");
}

function defaultConnectSnapshotSandbox(
  config: SandboxConnectConfig,
): Promise<SnapshotSandbox> {
  return connectSandbox(config);
}

export function createVercelSnapshotTemplateName(deploymentId: string): string {
  const scope = createHash("sha256")
    .update(
      `${VERCEL_SNAPSHOT_TEMPLATE_CONTRACT_VERSION}:${deploymentId.trim()}`,
    )
    .digest("hex")
    .slice(0, 20);

  return `open-agents-sbx-tpl-${scope}`;
}

export async function resolveVercelSnapshotTemplateId(
  templateName: string,
): Promise<string | undefined> {
  try {
    const sandbox = await VercelSandboxSDK.get({
      name: templateName,
      resume: false,
    });
    return sandbox.currentSnapshotId;
  } catch (error) {
    if (isSandboxNotFoundError(error)) {
      return undefined;
    }
    throw error;
  }
}

export async function ensureVercelSnapshotTemplate(
  options: EnsureVercelSnapshotTemplateOptions,
  dependencies: VercelSnapshotTemplateDependencies = {},
): Promise<EnsureVercelSnapshotTemplateResult> {
  const log = options.log ?? (() => {});
  const connectSnapshotSandbox =
    dependencies.connectSandbox ?? defaultConnectSnapshotSandbox;
  const resolveSnapshotId =
    dependencies.resolveSnapshotId ?? resolveVercelSnapshotTemplateId;

  const existingSnapshotId = await resolveSnapshotId(options.templateName);
  if (existingSnapshotId) {
    log(
      `Reusing snapshot ${existingSnapshotId} from template ${options.templateName}.`,
    );
    return {
      templateName: options.templateName,
      snapshotId: existingSnapshotId,
      created: false,
    };
  }

  let sandbox: SnapshotSandbox | null = null;
  let snapshotCreated = false;

  try {
    log(`Creating snapshot template ${options.templateName}.`);
    sandbox = await connectSnapshotSandbox({
      state: { type: "vercel", sandboxName: options.templateName },
      options: {
        timeout: options.sandboxTimeoutMs,
        persistent: false,
        resume: true,
        createIfMissing: true,
        skipGitWorkspaceBootstrap: true,
        ...(options.baseSnapshotId !== undefined && {
          baseSnapshotId: options.baseSnapshotId,
        }),
        ...(options.ports !== undefined && { ports: options.ports }),
        ...(options.env !== undefined && { env: options.env }),
      },
    });

    if (!sandbox.snapshot) {
      throw new Error(
        "Configured sandbox provider does not support snapshots.",
      );
    }

    if (options.prepare) {
      log("Preparing sandbox template runtime profile.");
      await options.prepare(sandbox);
    }

    log(`Creating snapshot from template ${options.templateName}.`);
    const snapshot = await sandbox.snapshot();
    snapshotCreated = true;
    log(`Created snapshot ${snapshot.snapshotId}.`);

    return {
      templateName: options.templateName,
      snapshotId: snapshot.snapshotId,
      created: true,
    };
  } finally {
    if (sandbox && !snapshotCreated) {
      try {
        await sandbox.stop();
      } catch (error) {
        log(
          `Failed to stop sandbox after template setup attempt: ${toErrorMessage(error)}`,
        );
      }
    }
  }
}
