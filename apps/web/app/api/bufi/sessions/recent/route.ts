// BUFI ingress: list-recent bot-user sessions for the morning digest cron.
// Same shared Bearer secret as /api/bufi/dispatch.

import crypto from "node:crypto";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { sessions, workflowRuns } from "@/lib/db/schema";
import { sanitizeTraceText } from "@open-agents/traces";

const BUFI_BOT_USER_ID = "bufi-bridge-bot";

function verifyBufiIngress(req: NextRequest): boolean {
  const secret = process.env.OPEN_AGENTS_BUFI_INGRESS_SECRET;
  if (!secret) return false;
  const auth = req.headers.get("authorization");
  if (!auth) return false;
  const expected = `Bearer ${secret}`;
  if (auth.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(auth), Buffer.from(expected));
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  if (!verifyBufiIngress(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const sinceRaw = url.searchParams.get("since");
  const sinceMs = sinceRaw
    ? Number.parseInt(sinceRaw, 10)
    : Date.now() - 24 * 60 * 60 * 1000;
  const sinceDate = new Date(
    Number.isFinite(sinceMs) ? sinceMs : Date.now() - 24 * 60 * 60 * 1000,
  );

  const rows = await db
    .select({
      id: sessions.id,
      title: sessions.title,
      status: sessions.status,
      repoOwner: sessions.repoOwner,
      repoName: sessions.repoName,
      createdAt: sessions.createdAt,
      lifecycleState: sessions.lifecycleState,
      lifecycleError: sessions.lifecycleError,
    })
    .from(sessions)
    .where(
      and(
        eq(sessions.userId, BUFI_BOT_USER_ID),
        gte(sessions.createdAt, sinceDate),
      ),
    )
    .limit(50);

  const recentRuns =
    rows.length === 0
      ? []
      : await db
          .select({
            id: workflowRuns.id,
            sessionId: workflowRuns.sessionId,
            status: workflowRuns.status,
            finishedAt: workflowRuns.finishedAt,
            createdAt: workflowRuns.createdAt,
          })
          .from(workflowRuns)
          .where(
            inArray(
              workflowRuns.sessionId,
              rows.map((row) => row.id),
            ),
          )
          .orderBy(desc(workflowRuns.createdAt))
          .limit(200);
  const latestRunBySession = new Map<string, (typeof recentRuns)[number]>();
  for (const run of recentRuns) {
    if (!latestRunBySession.has(run.sessionId))
      latestRunBySession.set(run.sessionId, run);
  }

  return NextResponse.json(
    rows.map((row) => {
      const run = latestRunBySession.get(row.id);
      return {
        ...row,
        latestWorkflowRunId: run?.id ?? null,
        latestWorkflowStatus: run?.status ?? null,
        latestWorkflowFinishedAt: run?.finishedAt ?? null,
        lifecycleState: row.lifecycleState,
        lifecycleError: row.lifecycleError
          ? sanitizeTraceText(row.lifecycleError)
          : null,
      };
    }),
  );
}
