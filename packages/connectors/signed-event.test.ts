import { createHmac } from "node:crypto";
import { describe, expect, it } from "bun:test";
import {
  type ConnectorEventRegistry,
  type ConnectorManifest,
  type SignedConnectorEventInput,
  verifySignedConnectorEvent,
} from "./index";

const manifest: ConnectorManifest = {
  version: 1,
  workspaceId: "ws_1",
  connectionId: "conn_pipedream",
  adapter: "pipedream",
  appSlug: "gmail",
  ownerMode: "user-owned",
  credentialRef: "vault/pipedream/gmail",
  environment: "development",
  deploymentId: "dep_12345678",
  accounts: [
    { accountId: "acct_1", externalAccountId: "external_1", label: "Gmail" },
  ],
  capabilities: ["trigger", "knowledge-ingestion"],
  stages: ["canonical-write"],
  freshnessSloMs: 3_600_000,
  schemaVersion: "gmail.attachment.v1",
  redactionPolicy: "metadata-only",
};

function signature(
  secret: string,
  input: Omit<SignedConnectorEventInput, "signature">,
): string {
  return createHmac("sha256", secret)
    .update(
      `${input.timestampMs}.${input.eventId}.${input.deploymentId}.${input.rawBody}`,
    )
    .digest("hex");
}

describe("signed connector events", () => {
  it("resolves by deployment id, verifies HMAC, and rejects replay", async () => {
    const seen = new Set<string>();
    const registry: ConnectorEventRegistry = {
      async getByDeploymentId(deploymentId) {
        return deploymentId === manifest.deploymentId ? manifest : undefined;
      },
      async hasSeenEvent(eventId) {
        return seen.has(eventId);
      },
      async markSeenEvent(eventId) {
        seen.add(eventId);
      },
    };
    const unsigned = {
      deploymentId: "dep_12345678",
      environment: "development" as const,
      eventId: "evt_12345678",
      timestampMs: 1000,
      rawBody: '{"ok":true}',
    };
    const input = {
      ...unsigned,
      signature: signature("super-secret-signing-key", unsigned),
    };
    await expect(
      verifySignedConnectorEvent(
        input,
        registry,
        async () => "super-secret-signing-key",
        1000,
      ),
    ).resolves.toMatchObject({ workspaceId: "ws_1" });
    await expect(
      verifySignedConnectorEvent(
        input,
        registry,
        async () => "super-secret-signing-key",
        1000,
      ),
    ).rejects.toThrow("duplicate connector event");
  });

  it("rejects stale events and environment mismatches before canonical writes", async () => {
    const registry: ConnectorEventRegistry = {
      async getByDeploymentId() {
        return manifest;
      },
      async hasSeenEvent() {
        return false;
      },
      async markSeenEvent() {},
    };
    const unsigned = {
      deploymentId: "dep_12345678",
      environment: "production" as const,
      eventId: "evt_abcdef12",
      timestampMs: 0,
      rawBody: "{}",
    };
    const input = {
      ...unsigned,
      signature: signature("super-secret-signing-key", unsigned),
    };
    await expect(
      verifySignedConnectorEvent(
        input,
        registry,
        async () => "super-secret-signing-key",
        1_000_000,
      ),
    ).rejects.toThrow("replay window");
    await expect(
      verifySignedConnectorEvent(
        { ...input, timestampMs: 1000 },
        registry,
        async () => "super-secret-signing-key",
        1000,
      ),
    ).rejects.toThrow("environment mismatch");
  });
});
