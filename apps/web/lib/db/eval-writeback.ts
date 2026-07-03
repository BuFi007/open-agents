import { eq } from "drizzle-orm";
import { db } from "./client";
import { sessions } from "./schema";

/**
 * Write an LLM-as-judge verdict onto a session row; rendered as a
 * quality badge in the sessions UI. Native session traces are the
 * observability source of truth.
 */
export async function writeSessionEval(params: {
  sessionId: string;
  score: number;
  label: string;
}): Promise<boolean> {
  const updated = await db
    .update(sessions)
    .set({ evalScore: params.score, evalLabel: params.label })
    .where(eq(sessions.id, params.sessionId))
    .returning({ id: sessions.id });
  return updated.length > 0;
}
