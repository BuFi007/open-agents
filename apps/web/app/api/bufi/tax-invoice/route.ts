import { createHash, timingSafeEqual } from "node:crypto";
import {
  AiInvoiceArtifactDispatchSchema,
  AiInvoiceDocumentDispatchSchema,
  TaxInvoiceDispatchSchema,
  dispatchFromAiInvoiceArtifact,
  dispatchFromAiInvoiceDocument,
  type TaxInvoiceDispatch,
} from "@open-agents/tax-automation";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { type NextRequest, NextResponse } from "next/server";
import { start } from "workflow/api";
import { runTaxInvoiceWorkflow } from "@/app/workflows/tax-invoice";
import { db } from "@/lib/db/client";
import {
  createOperatingPackRun,
  getOperatingPackRunByIdempotency,
  updateOperatingPackRun,
} from "@/lib/db/operating-pack-runs";
import { users } from "@/lib/db/schema";
import { createSessionWithInitialChat } from "@/lib/db/sessions";

const BOT_USER_ID = "bufi-bridge-bot";

function authorized(request: NextRequest): boolean {
  const secret = process.env.OPEN_AGENTS_BUFI_INGRESS_SECRET;
  const actual = request.headers.get("authorization");
  if (!secret || !actual) return false;
  const expected = `Bearer ${secret}`;
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

async function ensureBotUser(): Promise<void> {
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, BOT_USER_ID))
    .limit(1);
  if (existing[0]) return;
  await db
    .insert(users)
    .values({
      id: BOT_USER_ID,
      username: BOT_USER_ID,
      email: "bridge@bu.finance",
      emailVerified: true,
      name: "BUFI Bridge Bot",
      isAdmin: false,
    })
    .onConflictDoNothing({ target: users.id });
}

export async function POST(request: NextRequest) {
  if (!authorized(request))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null);
  const canonical = TaxInvoiceDispatchSchema.safeParse(body);
  const aiArtifact = canonical.success
    ? null
    : AiInvoiceArtifactDispatchSchema.safeParse(body);
  const aiDocument =
    canonical.success || aiArtifact?.success
      ? null
      : AiInvoiceDocumentDispatchSchema.safeParse(body);
  if (!canonical.success && !aiArtifact?.success && !aiDocument?.success)
    return NextResponse.json(
      { error: "Invalid tax invoice workflow request" },
      { status: 400 },
    );
  let dispatch: TaxInvoiceDispatch;
  try {
    if (canonical.success) dispatch = canonical.data;
    else if (aiArtifact?.success)
      dispatch = dispatchFromAiInvoiceArtifact(aiArtifact.data);
    else if (aiDocument?.success)
      dispatch = dispatchFromAiInvoiceDocument(aiDocument.data);
    else throw new Error("unreachable invalid dispatch");
  } catch {
    return NextResponse.json(
      { error: "AI invoice totals do not reconcile" },
      { status: 422 },
    );
  }
  const requestHash = createHash("sha256")
    .update(JSON.stringify(dispatch))
    .digest("hex");
  const existing = await getOperatingPackRunByIdempotency(
    dispatch.workspaceId,
    dispatch.idempotencyKey,
  );
  if (existing) {
    if (existing.requestHash !== requestHash)
      return NextResponse.json(
        { error: "Idempotency conflict" },
        { status: 409 },
      );
    return NextResponse.json(
      {
        executionId: existing.id,
        workflowRunId: existing.workflowRunId,
        status: existing.status,
        result: existing.result,
        replayed: true,
      },
      { status: 200 },
    );
  }

  await ensureBotUser();
  const sessionId = `tax_${nanoid(20)}`;
  const chatId = `tax_${nanoid(20)}`;
  await createSessionWithInitialChat({
    session: {
      id: sessionId,
      userId: BOT_USER_ID,
      title: `Tax invoice: ${dispatch.invoice.invoiceId}`,
      repoOwner: null,
      repoName: null,
      branch: null,
      cloneUrl: null,
      autoCommitPushOverride: false,
      autoCreatePrOverride: false,
    },
    initialChat: {
      id: chatId,
      title: "AI invoice to verified Factura E",
      modelId: null,
      harnessId: "pi",
    },
  });

  const executionId = `tax_${nanoid(24)}`;
  const claimed = await createOperatingPackRun({
    id: executionId,
    workspaceId: dispatch.workspaceId,
    sessionId,
    chatId,
    userId: BOT_USER_ID,
    packId: "tax_automation",
    workflowId: "ai_invoice_to_factura_e",
    harnessId: "pi",
    idempotencyKey: dispatch.idempotencyKey,
    requestHash,
    status: "pending",
  });
  if (!claimed.created)
    return NextResponse.json(
      {
        executionId: claimed.run.id,
        workflowRunId: claimed.run.workflowRunId,
        status: claimed.run.status,
        replayed: true,
      },
      { status: 200 },
    );

  try {
    const run = await start(runTaxInvoiceWorkflow, [{ executionId, dispatch }]);
    return NextResponse.json(
      {
        executionId,
        workflowRunId: run.runId,
        status: "pending",
        replayed: false,
      },
      { status: 202 },
    );
  } catch {
    await updateOperatingPackRun(executionId, {
      status: "failed",
      errorCode: "WORKFLOW_START_FAILED",
      finished: true,
    });
    return NextResponse.json(
      { error: "Failed to start tax invoice workflow" },
      { status: 503 },
    );
  }
}
