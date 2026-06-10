import { eq } from "drizzle-orm";
import { db } from "./client";
import { sessions } from "./schema";

/**
 * Write an LLM-as-judge verdict onto a session row. Used by the
 * Phoenix eval pipeline (scripts/phoenix-eval.ts); rendered as a
 * quality badge in the sessions UI.
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
