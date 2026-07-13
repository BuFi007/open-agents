import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { operatingPackCredentials } from "@/lib/db/schema";

const GRANT_TTL_MS = 8 * 24 * 60 * 60 * 1000;

export type SealedWorkspaceGrant = {
  ciphertext: string;
  iv: string;
  authTag: string;
};

function keyFromSecret(secret: string): Buffer {
  if (secret.length < 32)
    throw new Error("Operating-pack credential key is not configured");
  return createHash("sha256").update(secret).digest();
}

function credentialSecret(): string {
  return (
    process.env.OPERATING_PACK_CREDENTIAL_KEY ??
    process.env.ENCRYPTION_KEY ??
    ""
  );
}

export function sealWorkspaceGrant(
  grant: string,
  secret: string,
): SealedWorkspaceGrant {
  if (grant.length < 80 || grant.length > 2048)
    throw new Error("Workspace grant is invalid");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFromSecret(secret), iv);
  const ciphertext = Buffer.concat([
    cipher.update(grant, "utf8"),
    cipher.final(),
  ]);
  return {
    ciphertext: ciphertext.toString("base64url"),
    iv: iv.toString("base64url"),
    authTag: cipher.getAuthTag().toString("base64url"),
  };
}

export function openWorkspaceGrant(
  sealed: SealedWorkspaceGrant,
  secret: string,
): string {
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      keyFromSecret(secret),
      Buffer.from(sealed.iv, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(sealed.authTag, "base64url"));
    const value = Buffer.concat([
      decipher.update(Buffer.from(sealed.ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    if (value.length < 80 || value.length > 2048)
      throw new Error("invalid plaintext");
    return value;
  } catch {
    throw new Error("Operating-pack credential could not be opened");
  }
}

export async function storeOperatingPackWorkspaceGrant(input: {
  runId: string;
  workspaceId: string;
  grant: string;
}): Promise<void> {
  const sealed = sealWorkspaceGrant(input.grant, credentialSecret());
  await db.insert(operatingPackCredentials).values({
    runId: input.runId,
    workspaceId: input.workspaceId,
    ...sealed,
    expiresAt: new Date(Date.now() + GRANT_TTL_MS),
  });
}

export async function getOperatingPackWorkspaceGrant(
  runId: string,
  workspaceId: string,
): Promise<string> {
  const credential = await db.query.operatingPackCredentials.findFirst({
    where: eq(operatingPackCredentials.runId, runId),
  });
  if (
    !credential ||
    credential.workspaceId !== workspaceId ||
    credential.expiresAt.getTime() <= Date.now()
  )
    throw new Error("Operating-pack credential is unavailable or expired");
  return openWorkspaceGrant(credential, credentialSecret());
}

export async function deleteOperatingPackWorkspaceGrant(
  runId: string,
): Promise<void> {
  await db
    .delete(operatingPackCredentials)
    .where(eq(operatingPackCredentials.runId, runId));
}
