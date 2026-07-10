import { createTrace, type TraceEvent } from "@open-agents/traces";
import type {
  OperatingPackManifest,
  OperatingPackPermission,
} from "./manifest";
import { parseOperatingPackManifest } from "./manifest";

export type PackLifecycleState =
  | "available"
  | "pending-review"
  | "installed"
  | "disabled"
  | "removed"
  | "rolled-back";
export type PackInstallation = {
  workspaceId: string;
  manifest: OperatingPackManifest;
  state: PackLifecycleState;
  installedBy: string;
  installedAtMs: number;
  previousVersion?: OperatingPackManifest;
};

export type PackGovernanceDecision = {
  allowed: boolean;
  approvalRequired: boolean;
  reason: string;
  permissionAdditions: readonly OperatingPackPermission[];
  trace: TraceEvent;
};

const sensitive = new Set<OperatingPackPermission>([
  "data:write",
  "external:communicate",
  "erp:write",
  "wallet:spend",
]);

export function reviewPackChange(input: {
  workspaceId: string;
  runId: string;
  actorId: string;
  current?: OperatingPackManifest;
  candidate: unknown;
  allowedPermissions: readonly OperatingPackPermission[];
  atMs: number;
}): PackGovernanceDecision {
  const candidate = parseOperatingPackManifest(input.candidate);
  const currentPermissions = new Set(input.current?.permissions);
  const additions = candidate.permissions.filter(
    (permission) => !currentPermissions.has(permission),
  );
  const exceedsPolicy = candidate.permissions.some(
    (permission) => !input.allowedPermissions.includes(permission),
  );
  const approvalRequired = additions.some((permission) =>
    sensitive.has(permission),
  );
  const allowed = !exceedsPolicy;
  const action = input.current ? "upgrade" : "install";
  return {
    allowed,
    approvalRequired,
    reason: exceedsPolicy
      ? "pack requests permissions outside workspace policy"
      : approvalRequired
        ? `${action} requires admin approval for sensitive permissions`
        : `${action} is within workspace policy`,
    permissionAdditions: additions,
    trace: createTrace({
      workspaceId: input.workspaceId,
      runId: input.runId,
      type: approvalRequired ? "approval.requested" : "artifact.emitted",
      summary: `operating pack ${action}: ${candidate.id}@${candidate.version}`,
      data: {
        packId: candidate.id,
        version: candidate.version,
        actorId: input.actorId,
        permissionAdditions: additions,
        allowed,
      },
      at: input.atMs,
    }),
  };
}

export function removeOperatingPack(
  installation: PackInstallation,
  atMs: number,
): {
  installation: PackInstallation;
  preservedGraphData: true;
  trace: TraceEvent;
} {
  return {
    installation: { ...installation, state: "removed" },
    preservedGraphData: true,
    trace: createTrace({
      workspaceId: installation.workspaceId,
      runId: `pack:${installation.manifest.id}`,
      type: "run.cancelled",
      summary: `operating pack removed: ${installation.manifest.id}`,
      data: {
        packId: installation.manifest.id,
        version: installation.manifest.version,
      },
      at: atMs,
    }),
  };
}

export function rollbackOperatingPack(
  installation: PackInstallation,
): PackInstallation {
  if (!installation.previousVersion)
    throw new Error("pack has no rollback version");
  return {
    ...installation,
    manifest: installation.previousVersion,
    state: "rolled-back",
    previousVersion: installation.manifest,
  };
}
