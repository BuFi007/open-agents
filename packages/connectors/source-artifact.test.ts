import { describe, expect, it } from "bun:test";
import { createSourceArtifact, sourceArtifactStageOperationId } from "./index";

const hashA =
  "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const hashB =
  "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

describe("source artifacts", () => {
  it("uses content hash for manual identity instead of random upload keys", () => {
    const first = createSourceArtifact({
      workspaceId: "ws_1",
      connectorId: "manual_uploads",
      provider: "manual",
      contentHash: hashA,
      mimeType: "application/pdf",
      sizeBytes: 100,
      filename: "invoice.pdf",
      receivedAtMs: 1000,
      observedAtMs: 1000,
      safeStorageRef: "storage/manual/hash-a",
      schemaVersion: "source-artifact.v1",
      normalizerVersion: "manual.v1",
      correlationId: "corr_1",
      redaction: "standard",
    });
    const renamed = createSourceArtifact({
      ...first,
      filename: "renamed.pdf",
      safeStorageRef: "storage/manual/hash-a-copy",
    });
    expect(first.artifactKey).toBe(renamed.artifactKey);
    expect(sourceArtifactStageOperationId(first, "canonical-write")).toContain(
      "canonical-write",
    );
  });

  it("uses provider account and native attachment identity for Gmail and Outlook", () => {
    const gmail = createSourceArtifact({
      workspaceId: "ws_1",
      connectorId: "gmail_inbox",
      provider: "gmail",
      accountId: "acct_google_1",
      externalContainerId: "msg_1",
      externalArtifactId: "att_1",
      contentHash: hashA,
      mimeType: "application/pdf",
      sizeBytes: 100,
      filename: "invoice.pdf",
      receivedAtMs: 1000,
      observedAtMs: 2000,
      safeStorageRef: "storage/gmail/a",
      schemaVersion: "source-artifact.v1",
      normalizerVersion: "gmail.v1",
      correlationId: "corr_1",
      redaction: "metadata-only",
    });
    const sameNameDifferentAttachment = createSourceArtifact({
      ...gmail,
      externalArtifactId: "att_2",
      contentHash: hashB,
      safeStorageRef: "storage/gmail/b",
    });
    const outlook = createSourceArtifact({
      ...gmail,
      provider: "outlook",
      connectorId: "outlook_inbox",
      accountId: "acct_ms_1",
    });
    expect(gmail.artifactKey).not.toBe(sameNameDifferentAttachment.artifactKey);
    expect(gmail.artifactKey).not.toBe(outlook.artifactKey);
    expect(gmail.receivedAtMs).toBe(1000);
  });

  it("rejects missing native provider IDs and invalid timestamps", () => {
    expect(() =>
      createSourceArtifact({
        workspaceId: "ws_1",
        connectorId: "gmail_inbox",
        provider: "gmail",
        contentHash: hashA,
        mimeType: "application/pdf",
        sizeBytes: 100,
        receivedAtMs: 1000,
        observedAtMs: 1000,
        safeStorageRef: "storage/gmail/a",
        schemaVersion: "source-artifact.v1",
        normalizerVersion: "gmail.v1",
        correlationId: "corr_1",
        redaction: "metadata-only",
      }),
    ).toThrow("accountId");
  });

  it("accepts the connected workspace provider identities without storing payloads", () => {
    const providers = [
      "pipedream",
      "magic-inbox",
      "quickbooks",
      "xero",
      "contaazul",
      "contabilium",
    ] as const;
    const keys = providers.map((provider) =>
      createSourceArtifact({
        workspaceId: "ws_1",
        connectorId: `${provider}_connector`,
        provider,
        accountId: "acct_1",
        externalContainerId: "container_1",
        externalArtifactId: `${provider}_artifact_1`,
        contentHash: hashA,
        mimeType: "application/json",
        sizeBytes: 32,
        receivedAtMs: 1_000,
        observedAtMs: 1_000,
        safeStorageRef: `storage/${provider}/artifact-1`,
        schemaVersion: "source-artifact.v1",
        normalizerVersion: `${provider}.v1`,
        correlationId: `corr_${provider}`,
        redaction: "metadata-only",
      }),
    );
    expect(new Set(keys.map((artifact) => artifact.artifactKey)).size).toBe(
      providers.length,
    );
    expect(keys.every((artifact) => !("payload" in artifact))).toBe(true);
  });
});
