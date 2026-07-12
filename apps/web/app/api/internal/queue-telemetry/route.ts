import { createHash, timingSafeEqual } from "node:crypto";
import { parseQueueTelemetryExport } from "@open-agents/queues";
import { type NextRequest, NextResponse } from "next/server";
import { appendOperatingPackTraceNext } from "@/lib/db/operating-pack-runs";

const MAX_BODY_BYTES = 128 * 1024;

function authorized(request: NextRequest): boolean {
  const secret = process.env.OPEN_AGENTS_QUEUE_TELEMETRY_SECRET;
  const actual = request.headers.get("authorization");
  if (!secret || secret.length < 32 || !actual) return false;
  const expected = `Bearer ${secret}`;
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

export async function POST(request: NextRequest) {
  if (!authorized(request))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isSafeInteger(contentLength) || contentLength > MAX_BODY_BYTES)
    return NextResponse.json(
      { error: "Queue telemetry body is too large" },
      { status: 413 },
    );
  const body = await request.json().catch(() => null);
  let exported;
  try {
    exported = parseQueueTelemetryExport(body);
  } catch {
    return NextResponse.json(
      { error: "Invalid queue telemetry export" },
      { status: 400 },
    );
  }
  try {
    const persisted = await appendOperatingPackTraceNext({
      id: exported.exportId,
      runId: exported.runId,
      workspaceId: exported.workspaceId,
      type: "queue.telemetry",
      agentId: "queue:bullmq",
      summary:
        exported.alerts.length > 0
          ? `Queue telemetry: ${exported.alerts.length} SLO alert(s)`
          : "Queue telemetry: within configured SLOs",
      data: {
        schemaVersion: exported.schemaVersion,
        generatedAtMs: exported.generatedAtMs,
        firstFactAtMs: exported.firstFactAtMs,
        lastFactAtMs: exported.lastFactAtMs,
        factCount: exported.factCount,
        trackedJobs: exported.trackedJobs,
        evictedJobs: exported.evictedJobs,
        metrics: exported.metrics,
        alerts: exported.alerts,
        integrityHash: createHash("sha256")
          .update(exported.exportId)
          .digest("hex"),
      },
    });
    return NextResponse.json(
      {
        accepted: true,
        replayed: persisted.replayed,
        sequence: persisted.sequence,
      },
      { status: persisted.replayed ? 200 : 202 },
    );
  } catch (error) {
    const candidate = error as { code?: unknown; name?: unknown };
    console.error(
      JSON.stringify({
        event: "queue.telemetry.persist_failed",
        errorCode: "QUEUE_TELEMETRY_PERSIST_FAILED",
        errorName:
          typeof candidate.name === "string" ? candidate.name.slice(0, 80) : "unknown",
        databaseCode:
          typeof candidate.code === "string" ? candidate.code.slice(0, 40) : undefined,
      }),
    );
    return NextResponse.json(
      { error: "Queue telemetry run is unavailable" },
      { status: 409 },
    );
  }
}
