import { describe, expect, it } from "bun:test";
import { compileConnectorLeafJobs, selectConnectorAccount, validateConnectorManifest, type ConnectorManifest } from "./index";

const manifest: ConnectorManifest = {
  version: 1,
  workspaceId: "ws_1",
  connectionId: "conn_pipedream_qbo",
  adapter: "pipedream",
  appSlug: "quickbooks",
  ownerMode: "team-shared",
  credentialRef: "vault/pipedream/qbo",
  environment: "development",
  deploymentId: "dep_12345678",
  accounts: [
    { accountId: "acct_a", externalAccountId: "pd_a", label: "A" },
    { accountId: "acct_b", externalAccountId: "pd_b", label: "B", isDefault: true },
  ],
  capabilities: ["tool", "snapshot", "knowledge-ingestion"],
  stages: ["canonical-write", "enrichment", "projection"],
  freshnessSloMs: 3_600_000,
  schemaVersion: "qbo.invoice.v1",
  redactionPolicy: "standard",
};

describe("connector manifest contract", () => {
  it("requires explicit account selection unless one default exists", () => {
    expect(selectConnectorAccount(manifest).accountId).toBe("acct_b");
    expect(selectConnectorAccount({ ...manifest, accounts: manifest.accounts.map(account => ({ ...account, isDefault: false })) }, "acct_a").externalAccountId).toBe("pd_a");
    expect(() => selectConnectorAccount({ ...manifest, accounts: manifest.accounts.map(account => ({ ...account, isDefault: false })) })).toThrow("account selection is required");
  });

  it("validates Pipedream deployment and compiles bounded queue leaf jobs", () => {
    expect(validateConnectorManifest(manifest).capabilities).toContain("knowledge-ingestion");
    const jobs = compileConnectorLeafJobs(manifest, "rev_20260710");
    expect(jobs.map(job => job.kind)).toEqual(["canonical-write", "enrichment", "projection"]);
    expect(jobs.every(job => job.workspaceId === "ws_1" && job.idempotencyKey.includes("qbo.invoice.v1"))).toBe(true);
  });
});
