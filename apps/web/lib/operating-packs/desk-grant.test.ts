import { createHmac } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { verifyDeskWorkspaceGrant } from "./desk-grant";

const secret = "desk-workspace-grant-secret-value-32";
const workspaceId = "11111111-1111-4111-8111-111111111111";

function grant(overrides: Record<string, unknown> = {}): string {
  const payload = Buffer.from(
    JSON.stringify({
      v: 1,
      workspaceId,
      subject: "22222222-2222-4222-8222-222222222222",
      issuedAt: 1_000,
      expiresAt: 10_000,
      nonce: "33333333-3333-4333-8333-333333333333",
      scopes: ["knowledge.read", "agent-wallet.read"],
      ...overrides,
    }),
  ).toString("base64url");
  const signature = createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

describe("Desk workspace grants", () => {
  test("accepts only a live grant bound to the requested workspace", () => {
    expect(
      verifyDeskWorkspaceGrant({
        token: grant(),
        workspaceId,
        secret,
        now: 5_000,
      }),
    ).toMatchObject({
      workspaceId,
      scopes: ["knowledge.read", "agent-wallet.read"],
    });
    expect(
      verifyDeskWorkspaceGrant({
        token: grant(),
        workspaceId: "44444444-4444-4444-8444-444444444444",
        secret,
        now: 5_000,
      }),
    ).toBeNull();
    expect(
      verifyDeskWorkspaceGrant({
        token: grant(),
        workspaceId,
        secret,
        now: 10_000,
      }),
    ).toBeNull();
  });

  test("rejects tampering, future grants, extra fields and weak configuration", () => {
    const valid = grant();
    expect(
      verifyDeskWorkspaceGrant({
        token: `${valid.slice(0, -1)}x`,
        workspaceId,
        secret,
        now: 5_000,
      }),
    ).toBeNull();
    expect(
      verifyDeskWorkspaceGrant({
        token: grant({ issuedAt: 100_000 }),
        workspaceId,
        secret,
        now: 5_000,
      }),
    ).toBeNull();
    expect(
      verifyDeskWorkspaceGrant({
        token: grant({ admin: true }),
        workspaceId,
        secret,
        now: 5_000,
      }),
    ).toBeNull();
    expect(
      verifyDeskWorkspaceGrant({
        token: valid,
        workspaceId,
        secret: "weak",
        now: 5_000,
      }),
    ).toBeNull();
  });
});
