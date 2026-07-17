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

  test("accepts a least-privilege invoice preparation grant", () => {
    expect(
      verifyDeskWorkspaceGrant({
        token: grant({ scopes: ["tax.invoice.prepare"] }),
        workspaceId,
        secret,
        now: 5_000,
      }),
    ).toMatchObject({
      workspaceId,
      scopes: ["tax.invoice.prepare"],
    });
    expect(
      verifyDeskWorkspaceGrant({
        token: grant({
          scopes: ["tax.invoice.prepare", "tax.invoice.prepare"],
        }),
        workspaceId,
        secret,
        now: 5_000,
      }),
    ).toBeNull();
  });

  test("accepts authority approval only as its dedicated Tax scope", () => {
    expect(
      verifyDeskWorkspaceGrant({
        token: grant({
          subject: "oaUser_nanoid-123456789",
          scopes: ["tax.invoice.authority.approve"],
        }),
        workspaceId,
        secret,
        now: 5_000,
      }),
    ).toMatchObject({
      workspaceId,
      subject: "oaUser_nanoid-123456789",
      scopes: ["tax.invoice.authority.approve"],
    });
  });

  test("accepts the dedicated accountant portfolio read scope", () => {
    expect(
      verifyDeskWorkspaceGrant({
        token: grant({ scopes: ["tax.accountant.portfolio.read"] }),
        workspaceId,
        secret,
        now: 5_000,
      }),
    ).toMatchObject({ scopes: ["tax.accountant.portfolio.read"] });
  });

  test("accepts the dedicated accountant review queue read scope", () => {
    expect(
      verifyDeskWorkspaceGrant({
        token: grant({ scopes: ["tax.accountant.review_queue.read"] }),
        workspaceId,
        secret,
        now: 5_000,
      }),
    ).toMatchObject({ scopes: ["tax.accountant.review_queue.read"] });
  });

  test("accepts UUID and nanoid subjects but rejects malformed identity text", () => {
    for (const subject of [
      "22222222-2222-4222-8222-222222222222",
      "V1StGXR8_Z5jdHi6B-myT",
    ])
      expect(
        verifyDeskWorkspaceGrant({
          token: grant({ subject }),
          workspaceId,
          secret,
          now: 5_000,
        }),
      ).toMatchObject({ subject });

    for (const subject of [
      "",
      "a".repeat(192),
      "lookalike_\u0430ctor",
      "actor with spaces",
      "../actor",
    ])
      expect(
        verifyDeskWorkspaceGrant({
          token: grant({ subject }),
          workspaceId,
          secret,
          now: 5_000,
        }),
      ).toBeNull();
  });

  test("accepts a least-privilege Tax snapshot read grant", () => {
    expect(
      verifyDeskWorkspaceGrant({
        token: grant({ scopes: ["tax.snapshot.read"] }),
        workspaceId,
        secret,
        now: 5_000,
      }),
    ).toMatchObject({
      workspaceId,
      scopes: ["tax.snapshot.read"],
    });
  });

  test("accepts factoring projection reads only as their narrow scope", () => {
    expect(
      verifyDeskWorkspaceGrant({
        token: grant({ scopes: ["tax.factoring.read"] }),
        workspaceId,
        secret,
        now: 5_000,
      }),
    ).toMatchObject({ workspaceId, scopes: ["tax.factoring.read"] });
  });

  test("accepts each Tax setup authority only as its own narrow scope", () => {
    for (const scope of [
      "tax.setup.read",
      "tax.profile.confirm",
      "tax.snapshot.configure",
    ]) {
      expect(
        verifyDeskWorkspaceGrant({
          token: grant({ scopes: [scope] }),
          workspaceId,
          secret,
          now: 5_000,
        }),
      ).toMatchObject({ workspaceId, scopes: [scope] });
    }
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
        token: grant({ issuedAt: 100_000, expiresAt: 101_000 }),
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

  test("rejects inverted, overlong and stale grant lifetimes", () => {
    expect(
      verifyDeskWorkspaceGrant({
        token: grant({ issuedAt: 10_000, expiresAt: 10_000 }),
        workspaceId,
        secret,
        now: 5_000,
      }),
    ).toBeNull();
    expect(
      verifyDeskWorkspaceGrant({
        token: grant({ issuedAt: 1_000, expiresAt: 301_001 }),
        workspaceId,
        secret,
        now: 5_000,
      }),
    ).toBeNull();
    expect(
      verifyDeskWorkspaceGrant({
        token: grant({ issuedAt: 1_000, expiresAt: 200_000 }),
        workspaceId,
        secret,
        now: 301_001,
      }),
    ).toBeNull();
  });
});
