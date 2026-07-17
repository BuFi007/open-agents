import { timingSafeEqual } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import { start } from "workflow/api";

import { runTaxDomainEventCertificationWorkflow } from "@/app/workflows/tax-domain-event-certification";
import {
  attachOperatingPackWorkflowRun,
  createOperatingPackRun,
  getOperatingPackRunByIdempotency,
  updateOperatingPackRun,
} from "@/lib/db/operating-pack-runs";
import { bindTaxCaseRun } from "@/lib/db/tax-domain-events";
import { ensureSessionWithInitialChat } from "@/lib/db/sessions";
import { readBoundedJson } from "@/lib/http/bounded-json";
import { ensureDeskBridgeUser } from "@/lib/operating-packs/desk-bridge-user";
import {
  taxDomainEventCertificationEnabled,
  taxDomainEventCertificationRefs,
  taxDomainEventCertificationRequestSchema,
  taxDomainEventCertificationResultSchema,
} from "@/lib/operating-packs/tax-domain-event-certification";

const MAX_REQUEST_BYTES = 1024;

function authorized(request: Request): boolean {
  const secret =
    process.env.OPEN_AGENTS_TAX_DOMAIN_EVENT_CERTIFICATION_SECRET ?? "";
  const actual = request.headers.get("authorization");
  if (Buffer.byteLength(secret) < 32 || !actual) return false;
  const expected = `Bearer ${secret}`;
  return (
    actual.length === expected.length &&
    timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
  );
}

function unavailable() {
  return privateJson({ error: "Not found" }, 404);
}

function startProjection(input: {
  refs: ReturnType<typeof taxDomainEventCertificationRefs>;
  status: string;
  workflowRunRef: string | null;
  replayed: boolean;
}) {
  return {
    version: "tax-domain-event-certification-start-v1" as const,
    certificationId: input.refs.certificationId,
    workspaceRef: input.refs.workspaceRef,
    caseRef: input.refs.caseRef,
    runRef: input.refs.runRef,
    workflowRunRef: input.workflowRunRef,
    status: input.status,
    replayed: input.replayed,
  };
}

function runIdentityMatches(
  run: NonNullable<
    Awaited<ReturnType<typeof getOperatingPackRunByIdempotency>>
  >,
  refs: ReturnType<typeof taxDomainEventCertificationRefs>,
): boolean {
  return (
    run.id === refs.runRef &&
    run.workspaceId === refs.workspaceRef &&
    run.idempotencyKey === refs.idempotencyKey &&
    run.requestHash === refs.requestHash &&
    run.packId === "tax_automation" &&
    run.workflowId === "tax_domain_event_certification"
  );
}

export async function POST(request: NextRequest) {
  if (!taxDomainEventCertificationEnabled()) return unavailable();
  if (!authorized(request)) return privateJson({ error: "Unauthorized" }, 401);
  const parsed = taxDomainEventCertificationRequestSchema.safeParse(
    await readBoundedJson(request, MAX_REQUEST_BYTES).catch(() => null),
  );
  if (!parsed.success)
    return privateJson({ error: "Invalid certification request" }, 400);
  const refs = taxDomainEventCertificationRefs(parsed.data.certificationId);
  const existing = await getOperatingPackRunByIdempotency(
    refs.workspaceRef,
    refs.idempotencyKey,
  );
  if (existing) {
    if (!runIdentityMatches(existing, refs))
      return privateJson({ error: "Certification identity conflict" }, 409);
    return privateJson(
      startProjection({
        refs,
        status: existing.status,
        workflowRunRef: existing.workflowRunId,
        replayed: true,
      }),
      200,
    );
  }

  const userId = await ensureDeskBridgeUser(
    `tax-domain-event-certification:${refs.certificationId}`,
  );
  await ensureSessionWithInitialChat({
    session: {
      id: refs.sessionRef,
      userId,
      title: "Tax domain event certification",
      repoOwner: null,
      repoName: null,
      branch: null,
      cloneUrl: null,
      autoCommitPushOverride: false,
      autoCreatePrOverride: false,
    },
    initialChat: {
      id: refs.chatRef,
      title: "Durable TaxCase event wake",
      modelId: null,
      harnessId: "pi",
    },
  });
  const claimed = await createOperatingPackRun({
    id: refs.runRef,
    workspaceId: refs.workspaceRef,
    sessionId: refs.sessionRef,
    chatId: refs.chatRef,
    userId,
    packId: "tax_automation",
    workflowId: "tax_domain_event_certification",
    harnessId: "pi",
    idempotencyKey: refs.idempotencyKey,
    requestHash: refs.requestHash,
    status: "pending",
  });
  if (!claimed.created) {
    if (!runIdentityMatches(claimed.run, refs))
      return privateJson({ error: "Certification identity conflict" }, 409);
    return privateJson(
      startProjection({
        refs,
        status: claimed.run.status,
        workflowRunRef: claimed.run.workflowRunId,
        replayed: true,
      }),
      200,
    );
  }
  try {
    await bindTaxCaseRun({
      workspaceId: refs.workspaceRef,
      taxRunId: refs.caseRef,
      operatingPackRunId: refs.runRef,
      caseKind: "workspace",
    });
    const workflow = await start(runTaxDomainEventCertificationWorkflow, [
      {
        workspaceRef: refs.workspaceRef,
        caseRef: refs.caseRef,
        runRef: refs.runRef,
      },
    ]);
    await attachOperatingPackWorkflowRun(refs.runRef, workflow.runId);
    return privateJson(
      startProjection({
        refs,
        status: "pending",
        workflowRunRef: workflow.runId,
        replayed: false,
      }),
      202,
    );
  } catch {
    await updateOperatingPackRun(refs.runRef, {
      status: "failed",
      errorCode: "TAX_DOMAIN_EVENT_CERTIFICATION_START_FAILED",
      finished: true,
    });
    return privateJson({ error: "Certification start unavailable" }, 503);
  }
}

export async function GET(request: NextRequest) {
  if (!taxDomainEventCertificationEnabled()) return unavailable();
  if (!authorized(request)) return privateJson({ error: "Unauthorized" }, 401);
  const parsed = taxDomainEventCertificationRequestSchema.safeParse({
    certificationId: new URL(request.url).searchParams.get("certificationId"),
  });
  if (!parsed.success)
    return privateJson({ error: "Invalid certification request" }, 400);
  const refs = taxDomainEventCertificationRefs(parsed.data.certificationId);
  const run = await getOperatingPackRunByIdempotency(
    refs.workspaceRef,
    refs.idempotencyKey,
  );
  if (!run || run.id !== refs.runRef)
    return privateJson({ error: "Certification not found" }, 404);
  const result = taxDomainEventCertificationResultSchema.safeParse(run.result);
  return privateJson(
    {
      version: "tax-domain-event-certification-status-v1",
      certificationId: refs.certificationId,
      runRef: refs.runRef,
      caseRef: refs.caseRef,
      workflowRunRef: run.workflowRunId,
      status: run.status,
      eventId: result.success ? result.data.eventId : null,
    },
    200,
  );
}

function privateJson(value: unknown, status: number) {
  return NextResponse.json(value, {
    status,
    headers: {
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
