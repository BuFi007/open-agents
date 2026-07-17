import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const DESK_WORKSPACE_GRANT_MAX_TTL_MS = 5 * 60_000;
const DESK_WORKSPACE_GRANT_CLOCK_SKEW_MS = 60_000;
const deskGrantSubjectSchema = z
  .string()
  .min(2)
  .max(191)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]+$/);

const grantPayloadSchema = z
  .object({
    v: z.literal(1),
    workspaceId: z.string().uuid(),
    // Desk must mint human-action grants to the exact OA session user ID.
    // UUID service actors remain valid; no normalization or truncation occurs.
    subject: deskGrantSubjectSchema,
    issuedAt: z.number().int().positive().safe(),
    expiresAt: z.number().int().positive().safe(),
    nonce: z.string().uuid(),
    scopes: z
      .array(
        z.enum([
          "knowledge.read",
          "agent-wallet.read",
          "agent-wallet.spend",
          "tax.invoice.prepare",
          "tax.invoice.intent.approve",
          "tax.invoice.settlement",
          "tax.invoice.authority.approve",
          "tax.invoice.authority.sync",
          "tax.snapshot.read",
          "tax.setup.read",
          "tax.profile.confirm",
          "tax.snapshot.configure",
          "tax.factoring.read",
          "tax.accountant.portfolio.read",
        ]),
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
      grant.expiresAt <= grant.issuedAt ||
      grant.expiresAt - grant.issuedAt > DESK_WORKSPACE_GRANT_MAX_TTL_MS ||
      grant.issuedAt > now + DESK_WORKSPACE_GRANT_CLOCK_SKEW_MS ||
      grant.issuedAt < now - DESK_WORKSPACE_GRANT_MAX_TTL_MS ||
      grant.expiresAt <= now
    )
      return null;
    return grant;
  } catch {
    return null;
  }
}
