import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";

export function deskBridgeUserId(subject: string): string {
  return `desk_${createHash("sha256").update(subject).digest("hex").slice(0, 32)}`;
}

export async function ensureDeskBridgeUser(subject: string): Promise<string> {
  const id = deskBridgeUserId(subject);
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  if (existing[0]) return id;
  await db
    .insert(users)
    .values({
      id,
      username: id,
      email: `${id}@bridge.bu.finance`,
      emailVerified: true,
      name: "BUFI Desk Operator",
      isAdmin: false,
    })
    .onConflictDoNothing({ target: users.id });
  return id;
}
