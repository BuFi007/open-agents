import { describe, expect, it } from "bun:test";
import { createSourceArtifact } from "@open-agents/connectors";
import { createEffectStore, createExportPayableCommand, createPayableFromArtifactCommand, decideMatch, normalizeAccountingProvider, providerCapabilities } from "./index";

const artifact = createSourceArtifact({
  workspaceId: "ws_1",
  connectorId: "gmail_inbox",
  provider: "gmail",
  accountId: "acct_google_1",
  externalContainerId: "msg_1",
  externalArtifactId: "att_1",
  contentHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  mimeType: "application/pdf",
  sizeBytes: 100,
  receivedAtMs: 1000,
  observedAtMs: 2000,
  safeStorageRef: "storage/gmail/a",
  schemaVersion: "source-artifact.v1",
  normalizerVersion: "gmail.v1",
  correlationId: "corr_1",
  redaction: "metadata-only",
});

describe("durable ERP effect commands", () => {
  it("deduplicates payable creation by canonical SourceArtifact", async () => {
    const store = createEffectStore();
    const command = createPayableFromArtifactCommand(artifact);
    const first = await store.upsert(command);
    const duplicate = await store.upsert(command);
    expect(first.commandId).toBe(duplicate.commandId);
    expect(first.sourceArtifactKey).toBe(artifact.artifactKey);
  });

  it("normalizes provider aliases and blocks retries while an export is ambiguous", async () => {
    const store = createEffectStore();
    const command = await store.upsert(createExportPayableCommand({ workspaceId: "ws_1", billId: "bill_1", provider: "conta-azul", providerTenantId: "tenant_1" }));
    expect(command.provider).toBe("contaazul");
    await store.claim(command.commandId, 1000);
    const ambiguous = await store.record(command.commandId, { atMs: 2000, status: "ambiguous", requestFingerprint: "fp_1", providerIdempotencyToken: "token_1", evidenceHash: "hash_1" });
    expect(ambiguous.status).toBe("ambiguous");
    await expect(store.claim(command.commandId, 3000)).rejects.toThrow("requires reconciliation");
    const confirmed = await store.record(command.commandId, { atMs: 4000, status: "confirmed", providerReference: "erp_bill_1", evidenceHash: "hash_2" });
    expect(confirmed.status).toBe("confirmed");
    expect((await store.claim(command.commandId, 5000)).status).toBe("confirmed");
  });

  it("exposes provider capabilities and reviewable match evidence", () => {
    expect(normalizeAccountingProvider("qbo")).toBe("quickbooks");
    expect(providerCapabilities("contabilium").lookupByReference).toBe(true);
    expect(decideMatch({
      workspaceId: "ws_1",
      billId: "bill_1",
      sourceArtifactKey: artifact.artifactKey,
      threshold: 0.8,
      score: 0.79,
      factors: [{ name: "amount", sourceValue: "100.00", targetValue: "100.00", score: 1, evidenceHash: "hash_amount" }],
      decidedAtMs: 1000,
    })).toBe("needs-review");
  });
});
