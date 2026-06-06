import { createHmac, timingSafeEqual } from "node:crypto";

export const INTERNAL_HARNESS_SIGNATURE_HEADER =
  "x-open-agents-harness-signature";

function getInternalHarnessSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    throw new Error(
      "BETTER_AUTH_SECRET is required for internal harness calls",
    );
  }
  return secret;
}

export function signInternalHarnessRequest(body: string): string {
  return createHmac("sha256", getInternalHarnessSecret())
    .update(body)
    .digest("hex");
}

export function verifyInternalHarnessRequest(
  body: string,
  signature: string | null,
): boolean {
  if (!signature) {
    return false;
  }

  const expected = Buffer.from(signInternalHarnessRequest(body), "hex");
  const actual = Buffer.from(signature, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
