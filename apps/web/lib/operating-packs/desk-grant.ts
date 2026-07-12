import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const grantPayloadSchema = z
  .object({
    v: z.literal(1),
    workspaceId: z.string().uuid(),
    subject: z.string().uuid(),
    issuedAt: z.number().int().positive(),
    expiresAt: z.number().int().positive(),
    nonce: z.string().uuid(),
    scopes: z
      .array(
        z.enum(["knowledge.read", "agent-wallet.read", "tax.invoice.prepare"]),
      )
      .min(1)
      .max(3)
      .refine((scopes) => new Set(scopes).size === scopes.length),
  })
  .strict();

export type DeskWorkspaceGrant = z.infer<typeof grantPayloadSchema>;

function signature(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function verifyDeskWorkspaceGrant(input: {
  token: string;
  workspaceId: string;
  secret?: string;
  now?: number;
}): DeskWorkspaceGrant | null {
  const secret = input.secret ?? process.env.BUFI_AGENT_TOOL_BROKER_SECRET;
  if (!secret || secret.length < 32) return null;
  const [payload, supplied, extra] = input.token.split(".");
  if (!payload || !supplied || extra || !/^[A-Za-z0-9_-]{43}$/.test(supplied))
    return null;
  const expected = signature(secret, payload);
  if (
    supplied.length !== expected.length ||
    !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
  )
    return null;
  try {
    const grant = grantPayloadSchema.parse(
      JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
    );
    const now = input.now ?? Date.now();
    if (
      grant.workspaceId !== input.workspaceId ||
      grant.issuedAt > now + 60_000 ||
      grant.expiresAt <= now
    )
      return null;
    return grant;
  } catch {
    return null;
  }
}
