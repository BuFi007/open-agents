// BUFI ingress: promote recently completed bot sessions to the Phoenix
// "bufi-recall" dataset (auto-curation half of the self-improvement
// loop). Called by BUFI's coffee-digest cron after it composes the
// morning summary. Idempotent — promote skips sessions already pushed
// (dedup on metadata.bufi_id). Same shared Bearer secret as
// /api/bufi/dispatch.

import crypto from "node:crypto";
import {
  type CompletedSessionRow,
  promoteSuccesses,
} from "@open-agents/arize-phoenix";
import { and, eq, gte } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { sessions } from "@/lib/db/schema";

const BUFI_BOT_USER_ID = "bufi-bridge-bot";
const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;

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

export async function POST(req: NextRequest) {
  if (!verifyBufiIngress(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let sinceMs = Date.now() - DEFAULT_WINDOW_MS;
  try {
    const body = (await req.json()) as { sinceMs?: unknown };
    if (typeof body.sinceMs === "number" && Number.isFinite(body.sinceMs)) {
      sinceMs = body.sinceMs;
    }
  } catch {
    // Empty body — use the default window.
  }

  const rows = await db
    .select({
      id: sessions.id,
      title: sessions.title,
      status: sessions.status,
      repoOwner: sessions.repoOwner,
      repoName: sessions.repoName,
      createdAt: sessions.createdAt,
    })
    .from(sessions)
    .where(
      and(
        eq(sessions.userId, BUFI_BOT_USER_ID),
        eq(sessions.status, "completed"),
        gte(sessions.createdAt, new Date(sinceMs)),
      ),
    )
    .limit(50);

  const completedRows: CompletedSessionRow[] = rows.map((row) => ({
    id: row.id,
    title: row.title,
    repo:
      row.repoOwner && row.repoName ? `${row.repoOwner}/${row.repoName}` : null,
    traceId: null,
    source: "bufi-dispatch",
    completedAt: row.createdAt ?? null,
  }));

  const report = await promoteSuccesses({ rows: completedRows });
  return NextResponse.json(report);
}
