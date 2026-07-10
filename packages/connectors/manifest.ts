import type { QueueJob } from "@open-agents/queues";

export type ConnectorCapability =
  | "tool"
  | "trigger"
  | "snapshot"
  | "delta"
  | "write"
  | "knowledge-ingestion";
export type ConnectorOwnership = "team-shared" | "user-owned";
export type ConnectorEnvironment = "development" | "staging" | "production";
export type ConnectorStage =
  | "canonical-write"
  | "enrichment"
  | "embedding"
  | "projection";

export type ConnectorAccount = {
  accountId: string;
  externalAccountId: string;
  label: string;
  isDefault?: boolean;
};

export type ConnectorManifest = {
  version: number;
  workspaceId: string;
  connectionId: string;
  adapter: "native" | "pipedream";
  appSlug: string;
  ownerMode: ConnectorOwnership;
  credentialRef: string;
  environment: ConnectorEnvironment;
  deploymentId?: string;
  accounts: readonly ConnectorAccount[];
  capabilities: readonly ConnectorCapability[];
  stages: readonly ConnectorStage[];
  freshnessSloMs: number;
  schemaVersion: string;
  redactionPolicy: "metadata-only" | "standard" | "restricted";
};

const ID = /^[a-zA-Z0-9][a-zA-Z0-9:_./-]{1,127}$/;
const VERSION = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

export function validateConnectorManifest(
  manifest: ConnectorManifest,
): ConnectorManifest {
  if (!Number.isInteger(manifest.version) || manifest.version < 1)
    throw new Error("manifest version must be a positive integer");
  for (const [field, value] of Object.entries({
    workspaceId: manifest.workspaceId,
    connectionId: manifest.connectionId,
    appSlug: manifest.appSlug,
    credentialRef: manifest.credentialRef,
    schemaVersion: manifest.schemaVersion,
  })) {
    if (typeof value !== "string" || !ID.test(value))
      throw new Error(`invalid connector manifest ${field}`);
  }
  if (manifest.adapter === "pipedream" && !manifest.deploymentId)
    throw new Error("pipedream manifests require deploymentId");
  if (!VERSION.test(manifest.schemaVersion))
    throw new Error("invalid schema version");
  if (
    manifest.freshnessSloMs < 60_000 ||
    manifest.freshnessSloMs > 30 * 24 * 60 * 60 * 1000
  )
    throw new Error("freshness SLO is out of bounds");
  if (!manifest.accounts.length)
    throw new Error("connector manifests require at least one account");
  if (!manifest.capabilities.length)
    throw new Error("connector manifests require explicit capabilities");
  const accountIds = new Set<string>();
  for (const account of manifest.accounts) {
    if (!ID.test(account.accountId) || !ID.test(account.externalAccountId))
      throw new Error("invalid connector account identity");
    if (accountIds.has(account.accountId))
      throw new Error(`duplicate connector account: ${account.accountId}`);
    accountIds.add(account.accountId);
  }
  return {
    ...manifest,
    accounts: [...manifest.accounts],
    capabilities: [...new Set(manifest.capabilities)],
    stages: [...new Set(manifest.stages)],
  };
}

export function selectConnectorAccount(
  manifest: ConnectorManifest,
  requestedAccountId?: string,
): ConnectorAccount {
  const valid = validateConnectorManifest(manifest);
  if (requestedAccountId) {
    const account = valid.accounts.find(
      (candidate) => candidate.accountId === requestedAccountId,
    );
    if (!account)
      throw new Error(
        "requested connector account is not owned by this workspace connection",
      );
    return account;
  }
  const defaults = valid.accounts.filter((account) => account.isDefault);
  if (defaults.length === 1) return defaults[0]!;
  if (valid.accounts.length === 1) return valid.accounts[0]!;
  throw new Error(
    "connector account selection is required when multiple accounts are available",
  );
}

export function compileConnectorLeafJobs(
  manifest: ConnectorManifest,
  sourceRevision: string,
): readonly QueueJob[] {
  const valid = validateConnectorManifest(manifest);
  if (!ID.test(sourceRevision)) throw new Error("invalid source revision");
  return valid.stages.map((stage) => ({
    id: `${valid.connectionId}:${sourceRevision}:${stage}`,
    workspaceId: valid.workspaceId,
    kind: stage,
    idempotencyKey: `${valid.workspaceId}:${valid.connectionId}:${sourceRevision}:${stage}:${valid.schemaVersion}:v${valid.version}`,
    payload: {
      connectionId: valid.connectionId,
      sourceRevision,
      schemaVersion: valid.schemaVersion,
    },
  }));
}
