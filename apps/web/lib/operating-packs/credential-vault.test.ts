import { describe, expect, test } from "bun:test";
import { openWorkspaceGrant, sealWorkspaceGrant } from "./credential-vault";

const secret = "test-credential-key-that-is-at-least-thirty-two-bytes";
const grant = "signed-workspace-grant".padEnd(120, "x");

describe("operating-pack credential vault", () => {
  test("round-trips a workspace grant without retaining plaintext", () => {
    const sealed = sealWorkspaceGrant(grant, secret);
    expect(JSON.stringify(sealed)).not.toContain(grant);
    expect(openWorkspaceGrant(sealed, secret)).toBe(grant);
  });

  test("fails closed for tampering, wrong keys and invalid inputs", () => {
    const sealed = sealWorkspaceGrant(grant, secret);
    expect(() =>
      openWorkspaceGrant(
        {
          ...sealed,
          ciphertext: `${sealed.ciphertext[0] === "A" ? "B" : "A"}${sealed.ciphertext.slice(1)}`,
        },
        secret,
      ),
    ).toThrow("could not be opened");
    expect(() =>
      openWorkspaceGrant(
        sealed,
        "different-credential-key-that-is-long-enough",
      ),
    ).toThrow("could not be opened");
    expect(() => sealWorkspaceGrant("short", secret)).toThrow("invalid");
  });
});
