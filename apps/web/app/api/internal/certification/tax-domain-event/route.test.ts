import { beforeEach, describe, expect, mock, test } from "bun:test";

const certificationId = "10000000-0000-4000-8000-000000000001";
const secret = "certification-secret-that-is-at-least-thirty-two-bytes";
const eventId = "20000000-0000-4000-8000-000000000001";

let storedRun: Record<string, unknown> | null = null;
let bound: Record<string, unknown> | null = null;
let sessionCreated = 0;
let workflowStarts = 0;

mock.module("@/lib/db/operating-pack-runs", () => ({
  getOperatingPackRunByIdempotency: async () => storedRun,
  createOperatingPackRun: async (input: Record<string, unknown>) => {
    if (storedRun) return { created: false, run: storedRun };
    storedRun = {
      ...input,
      workflowRunId: null,
      result: null,
      errorCode: null,
    };
    return { created: true, run: storedRun };
  },
  attachOperatingPackWorkflowRun: async (_runId: string, runId: string) => {
    if (storedRun) storedRun.workflowRunId = runId;
  },
  updateOperatingPackRun: async (
    _runId: string,
    input: Record<string, unknown>,
  ) => {
    if (storedRun) Object.assign(storedRun, input);
  },
}));

mock.module("@/lib/db/tax-domain-events", () => ({
  bindTaxCaseRun: async (input: Record<string, unknown>) => {
    bound = input;
    return input;
  },
}));

mock.module("@/lib/db/sessions", () => ({
  ensureSessionWithInitialChat: async () => {
    sessionCreated += 1;
  },
}));

mock.module("@/lib/operating-packs/desk-bridge-user", () => ({
  ensureDeskBridgeUser: async () => "desk_certification_user",
}));

mock.module("workflow/api", () => ({
  start: async () => {
    workflowStarts += 1;
    return { runId: "workflow_certification_1" };
  },
}));

mock.module("@/app/workflows/tax-domain-event-certification", () => ({
  runTaxDomainEventCertificationWorkflow: async () => null,
}));

const { GET, POST } = await import("./route");

function postRequest(
  body: unknown,
  authorization = `Bearer ${secret}`,
): Request {
  const rawBody = JSON.stringify(body);
  return new Request(
    "https://preview.test/api/internal/certification/tax-domain-event",
    {
      method: "POST",
      headers: {
        authorization,
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(rawBody)),
      },
      body: rawBody,
    },
  );
}

function getRequest(authorization = `Bearer ${secret}`): Request {
  return new Request(
    `https://preview.test/api/internal/certification/tax-domain-event?certificationId=${certificationId}`,
    { headers: { authorization } },
  );
}

beforeEach(() => {
  process.env.OPEN_AGENTS_TAX_DOMAIN_EVENT_CERTIFICATION_ENABLED = "true";
  process.env.OPEN_AGENTS_TAX_DOMAIN_EVENT_CERTIFICATION_SECRET = secret;
  process.env.VERCEL_ENV = "preview";
  storedRun = null;
  bound = null;
  sessionCreated = 0;
  workflowStarts = 0;
});

describe("TaxDomainEventV1 certification route", () => {
  test("fails closed in production and authenticates before parsing", async () => {
    process.env.VERCEL_ENV = "production";
    expect((await POST(postRequest({ certificationId }) as never)).status).toBe(
      404,
    );
    process.env.VERCEL_ENV = "preview";
    expect(
      (await POST(postRequest({ certificationId }, "Bearer invalid") as never))
        .status,
    ).toBe(401);
    expect(sessionCreated).toBe(0);
  });

  test("creates an isolated bound TaxCase and starts a real workflow", async () => {
    const response = await POST(postRequest({ certificationId }) as never);
    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body).toMatchObject({
      version: "tax-domain-event-certification-start-v1",
      certificationId,
      workspaceRef: certificationId,
      status: "pending",
      workflowRunRef: "workflow_certification_1",
      replayed: false,
    });
    expect(body.caseRef).toMatch(/^taxcase_e2e_[a-f0-9]{40}$/);
    expect(body.runRef).toMatch(/^taxcert_[a-f0-9]{40}$/);
    expect(bound).toEqual({
      workspaceId: certificationId,
      taxRunId: body.caseRef,
      operatingPackRunId: body.runRef,
      caseKind: "workspace",
    });
    expect(sessionCreated).toBe(1);
    expect(workflowStarts).toBe(1);

    const replay = await POST(postRequest({ certificationId }) as never);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ replayed: true });
    expect(sessionCreated).toBe(1);
    expect(workflowStarts).toBe(1);
  });

  test("returns only sanitized durable status", async () => {
    const started = await POST(postRequest({ certificationId }) as never);
    expect(started.status).toBe(202);
    storedRun!.status = "completed";
    storedRun!.result = {
      version: "tax-domain-event-certification-result-v1",
      eventId,
      proof: "durable_tax_domain_event_wake",
    };
    const response = await GET(getRequest() as never);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      version: "tax-domain-event-certification-status-v1",
      certificationId,
      runRef: storedRun!.id,
      caseRef: bound!.taxRunId,
      workflowRunRef: "workflow_certification_1",
      status: "completed",
      eventId,
    });
    expect(JSON.stringify(body)).not.toMatch(
      /payload|credential|evidence|amount|cuit/i,
    );
  });
});
