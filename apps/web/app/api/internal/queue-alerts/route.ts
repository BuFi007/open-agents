import { timingSafeEqual } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { appendOperatingPackTraceNext } from "@/lib/db/operating-pack-runs";

const MAX_BODY_BYTES = 128 * 1024;
const identifier = z
  .string()
  .min(2)
  .max(191)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9:_./-]+$/);
const alertSchema = z
  .object({
    code: z.enum([
      "QUEUE_WAIT_SLO_EXCEEDED",
      "PROCESSING_SLO_EXCEEDED",
      "RETRY_RATE_EXCEEDED",
      "DEAD_LETTERS_PRESENT",
      "IN_FLIGHT_LIMIT_EXCEEDED",
    ]),
    profile: z.enum([
      "source-connectors",
      "document-ocr",
      "knowledge-ai",
      "business-notifications",
    ]),
    queue: identifier,
    observed: z.number().finite().nonnegative(),
    threshold: z.number().finite().nonnegative(),
  })
  .strict();
const payloadSchema = z
  .object({
    schemaVersion: z.literal(1),
    workspaceId: identifier,
    runId: identifier,
    exportId: z.string().regex(/^queue-telemetry:[a-f0-9]{64}$/),
    generatedAtMs: z.number().int().positive().safe(),
    alerts: z.array(alertSchema).min(1).max(500),
  })
  .strict();

function authorized(request: NextRequest): boolean {
  const secret =
    process.env.OPEN_AGENTS_QUEUE_ALERT_SECRET ??
    process.env.OPEN_AGENTS_QUEUE_TELEMETRY_SECRET;
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
      { error: "Queue alert body is too large" },
      { status: 413 },
    );
  const parsed = payloadSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid queue alert" }, { status: 400 });
  const payload = parsed.data;
  try {
    const persisted = await appendOperatingPackTraceNext({
      id: `${payload.exportId}:alerts`,
      runId: payload.runId,
      workspaceId: payload.workspaceId,
      type: "queue.alert",
      agentId: "queue:bullmq",
      summary: `Queue alert: ${payload.alerts.length} SLO violation(s)`,
      data: {
        schemaVersion: payload.schemaVersion,
        exportId: payload.exportId,
        generatedAtMs: payload.generatedAtMs,
        alerts: payload.alerts,
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
  } catch {
    return NextResponse.json(
      { error: "Queue alert run is unavailable" },
      { status: 409 },
    );
  }
}
