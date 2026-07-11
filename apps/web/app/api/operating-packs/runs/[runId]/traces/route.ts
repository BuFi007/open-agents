import { z } from "zod";
import { listOwnedOperatingPackTraces } from "@/lib/db/operating-pack-runs";
import { requireAuthenticatedUser } from "@/app/api/chat/_lib/chat-context";

const querySchema = z.object({
  after: z.coerce.number().int().min(0).max(1_000_000).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export async function GET(
  request: Request,
  context: { params: Promise<{ runId: string }> },
) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;
  const { runId } = await context.params;
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    after: url.searchParams.get("after") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  });
  if (!parsed.success)
    return Response.json({ error: "Invalid trace query" }, { status: 400 });
  const result = await listOwnedOperatingPackTraces({
    runId,
    userId: auth.userId,
    afterSequence: parsed.data.after,
    limit: parsed.data.limit,
  });
  if (!result)
    return Response.json({ error: "Run not found" }, { status: 404 });
  return Response.json({
    runId,
    traces: result.traces,
    nextAfter: result.traces.at(-1)?.sequence ?? parsed.data.after,
  });
}
