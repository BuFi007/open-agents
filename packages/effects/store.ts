import type { SourceArtifact } from "@open-agents/connectors";
import {
  normalizeAccountingProvider,
  type AccountingProvider,
} from "./providers";

export type DurableEffectStatus =
  | "pending"
  | "claimed"
  | "ambiguous"
  | "confirmed"
  | "failed";

export type EffectAttempt = {
  attempt: number;
  atMs: number;
  status: DurableEffectStatus;
  requestFingerprint?: string;
  providerIdempotencyToken?: string;
  providerReference?: string;
  evidenceHash?: string;
  errorCode?: string;
};

export type DurableEffectCommand = {
  commandId: string;
  workspaceId: string;
  kind: "CreatePayableFromArtifact" | "ExportPayableToERP";
  version: number;
  status: DurableEffectStatus;
  idempotencyKey: string;
  attempts: readonly EffectAttempt[];
  sourceArtifactKey?: string;
  billId?: string;
  provider?: AccountingProvider;
  providerTenantId?: string;
  reconciliationCursor?: string;
};

export type EffectStore = {
  upsert(
    command: Omit<DurableEffectCommand, "attempts" | "status">,
  ): Promise<DurableEffectCommand>;
  claim(commandId: string, atMs: number): Promise<DurableEffectCommand>;
  record(
    commandId: string,
    attempt: Omit<EffectAttempt, "attempt">,
  ): Promise<DurableEffectCommand>;
  get(commandId: string): Promise<DurableEffectCommand | undefined>;
};

const ID = /^[a-zA-Z0-9][a-zA-Z0-9:_./-]{1,191}$/;

function requireId(name: string, value: string | undefined): string {
  if (!value || !ID.test(value))
    throw new Error(`invalid effect command ${name}`);
  return value;
}

function clone(command: DurableEffectCommand): DurableEffectCommand {
  return {
    ...command,
    attempts: command.attempts.map((attempt) => ({ ...attempt })),
  };
}

export function createEffectStore(): EffectStore {
  const commands = new Map<string, DurableEffectCommand>();
  const idempotency = new Map<string, string>();
  return {
    async upsert(input) {
      requireId("workspaceId", input.workspaceId);
      requireId("commandId", input.commandId);
      requireId("idempotencyKey", input.idempotencyKey);
      const existingId = idempotency.get(
        `${input.workspaceId}:${input.idempotencyKey}`,
      );
      if (existingId) return clone(commands.get(existingId)!);
      const command = { ...input, status: "pending" as const, attempts: [] };
      commands.set(command.commandId, command);
      idempotency.set(
        `${command.workspaceId}:${command.idempotencyKey}`,
        command.commandId,
      );
      return clone(command);
    },
    async claim(commandId, atMs) {
      const command = commands.get(requireId("commandId", commandId));
      if (!command) throw new Error("effect command not found");
      if (command.status === "confirmed") return clone(command);
      if (command.status === "ambiguous")
        throw new Error(
          "ambiguous effect command requires reconciliation before retry",
        );
      const next = {
        ...command,
        status: "claimed" as const,
        attempts: [
          ...command.attempts,
          {
            attempt: command.attempts.length + 1,
            atMs,
            status: "claimed" as const,
          },
        ],
      };
      commands.set(commandId, next);
      return clone(next);
    },
    async record(commandId, attempt) {
      const command = commands.get(requireId("commandId", commandId));
      if (!command) throw new Error("effect command not found");
      const nextAttempt = { ...attempt, attempt: command.attempts.length + 1 };
      const next = {
        ...command,
        status: attempt.status,
        reconciliationCursor:
          command.reconciliationCursor ?? attempt.providerReference,
        attempts: [...command.attempts, nextAttempt],
      };
      commands.set(commandId, next);
      return clone(next);
    },
    async get(commandId) {
      const command = commands.get(commandId);
      return command ? clone(command) : undefined;
    },
  };
}

export function createPayableFromArtifactCommand(
  artifact: SourceArtifact,
  version = 1,
): Omit<DurableEffectCommand, "attempts" | "status"> {
  return {
    commandId: `${artifact.workspaceId}:payable:${artifact.artifactKey}:v${version}`,
    workspaceId: artifact.workspaceId,
    kind: "CreatePayableFromArtifact",
    version,
    idempotencyKey: `${artifact.workspaceId}:${artifact.artifactKey}:payable:v${version}`,
    sourceArtifactKey: artifact.artifactKey,
  };
}

export function createExportPayableCommand(input: {
  workspaceId: string;
  billId: string;
  provider: string;
  providerTenantId: string;
  version?: number;
}): Omit<DurableEffectCommand, "attempts" | "status"> {
  const provider = normalizeAccountingProvider(input.provider);
  const version = input.version ?? 1;
  requireId("workspaceId", input.workspaceId);
  requireId("billId", input.billId);
  requireId("providerTenantId", input.providerTenantId);
  return {
    commandId: `${input.workspaceId}:export:${input.billId}:${provider}:${input.providerTenantId}:v${version}`,
    workspaceId: input.workspaceId,
    kind: "ExportPayableToERP",
    version,
    idempotencyKey: `${input.workspaceId}:${input.billId}:${provider}:${input.providerTenantId}:v${version}`,
    billId: input.billId,
    provider,
    providerTenantId: input.providerTenantId,
  };
}
