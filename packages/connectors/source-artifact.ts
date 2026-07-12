import { createHash } from "node:crypto";
import type { ConnectorStage } from "./manifest";

export type SourceArtifactProvider =
  | "manual"
  | "gmail"
  | "outlook"
  | "pipedream"
  | "magic-inbox"
  | "quickbooks"
  | "xero"
  | "contaazul"
  | "contabilium";

export type SourceArtifactInput = {
  workspaceId: string;
  connectorId: string;
  provider: SourceArtifactProvider;
  accountId?: string;
  externalContainerId?: string;
  externalArtifactId?: string;
  contentHash: string;
  mimeType: string;
  sizeBytes: number;
  filename?: string;
  receivedAtMs: number;
  observedAtMs: number;
  safeStorageRef: string;
  senderEvidence?: string;
  schemaVersion: string;
  normalizerVersion: string;
  correlationId: string;
  causationId?: string;
  redaction: "metadata-only" | "standard" | "restricted";
  tombstone?: boolean;
};

export type SourceArtifact = SourceArtifactInput & {
  artifactKey: string;
  sourceRevision: string;
};

const ID = /^[a-zA-Z0-9][a-zA-Z0-9:_./@-]{1,191}$/;
const HASH = /^sha256:[a-f0-9]{64}$/;
const MIME = /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/i;

function requireId(name: string, value: string | undefined): string {
  if (!value || !ID.test(value))
    throw new Error(`invalid source artifact ${name}`);
  return value;
}

function providerIdentity(input: SourceArtifactInput): string {
  if (input.provider === "manual") return `manual:${input.contentHash}`;
  return [
    input.provider,
    requireId("accountId", input.accountId),
    requireId("externalContainerId", input.externalContainerId),
    requireId("externalArtifactId", input.externalArtifactId),
    input.contentHash,
  ].join(":");
}

export function createSourceArtifact(
  input: SourceArtifactInput,
): SourceArtifact {
  requireId("workspaceId", input.workspaceId);
  requireId("connectorId", input.connectorId);
  requireId("safeStorageRef", input.safeStorageRef);
  requireId("schemaVersion", input.schemaVersion);
  requireId("normalizerVersion", input.normalizerVersion);
  requireId("correlationId", input.correlationId);
  if (input.causationId) requireId("causationId", input.causationId);
  if (!HASH.test(input.contentHash))
    throw new Error("source artifact content hash must be sha256-prefixed");
  if (!MIME.test(input.mimeType))
    throw new Error("invalid source artifact MIME type");
  if (
    !Number.isInteger(input.sizeBytes) ||
    input.sizeBytes < 0 ||
    input.sizeBytes > 250 * 1024 * 1024
  )
    throw new Error("source artifact size is out of bounds");
  if (
    !Number.isInteger(input.receivedAtMs) ||
    !Number.isInteger(input.observedAtMs) ||
    input.receivedAtMs <= 0 ||
    input.observedAtMs <= 0
  )
    throw new Error("source artifact timestamps are required");
  if (input.receivedAtMs > input.observedAtMs + 60_000)
    throw new Error(
      "source artifact received time cannot be materially after observation",
    );
  const artifactKey = `artifact:${createHash("sha256")
    .update(
      `${input.workspaceId}:${input.connectorId}:${providerIdentity(input)}`,
    )
    .digest("hex")}`;
  const sourceRevision = `revision:${createHash("sha256")
    .update(`${artifactKey}:${input.schemaVersion}:${input.normalizerVersion}`)
    .digest("hex")}`;
  return {
    ...input,
    artifactKey,
    sourceRevision,
  };
}

export function sourceArtifactStageOperationId(
  artifact: SourceArtifact,
  stage: ConnectorStage,
): string {
  return `${artifact.artifactKey}:${artifact.sourceRevision}:${stage}`;
}
