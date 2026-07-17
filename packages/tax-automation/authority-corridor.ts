import { createHash, createHmac, randomBytes } from "node:crypto";
import { z } from "zod";

import { TaxAutomationRequestError } from "./request-error";

type Fetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

const MAX_RESPONSE_BYTES = 64 * 1024;
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const idempotencyKeySchema = z
  .string()
  .min(16)
  .max(200)
  .regex(/^[A-Za-z0-9._:-]+$/);

const registerApprovalInputSchema = z
  .object({
    executionId: z.string().uuid(),
    workspaceId: z.string().uuid(),
    intentHash: sha256Schema,
    approvalRef: z
      .string()
      .min(24)
      .max(240)
      .regex(/^oa_approval_[A-Za-z0-9_-]+$/),
    actorId: z.string().min(1).max(300),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

const receiptEnvelopeSchema = z
  .object({
    data: z
      .object({
        version: z.literal("factura-e-authority-execution-receipt-v1"),
        executionId: z.string().uuid(),
        workspaceId: z.string().uuid(),
        state: z.literal("approved"),
        replayed: z.boolean(),
        nextAction: z.literal("execute_with_one_use_approval"),
      })
      .strict(),
  })
  .strict();

export type RegisterFacturaEAuthorityApprovalInput = z.infer<
  typeof registerApprovalInputSchema
>;

export type SafeFacturaEAuthorityApprovalReceipt = Readonly<{
  version: "oa-factura-e-authority-approval-receipt-v1";
  executionId: string;
  workspaceId: string;
  intentHash: string;
  status: "registered";
  replayed: boolean;
  nextStep: "request_execution_from_motora";
}>;

export type TaxAuthorityApprovalClientOptions = Readonly<{
  baseUrl: string;
  approvalPrincipalSecret: string;
  fetchImpl?: Fetch;
  now?: () => Date;
  productionApproved?: boolean;
}>;

/**
 * Open Agents' sole authority capability: register an explicit, server-held
 * one-use approval. It cannot execute, recover or reconcile an ARCA effect.
 */
export class TaxAuthorityApprovalClient {
  readonly #baseUrl: URL;
  readonly #secret: string;
  readonly #fetch: Fetch;
  readonly #now: () => Date;

  constructor(options: TaxAuthorityApprovalClientOptions) {
    this.#baseUrl = safeBaseUrl(options.baseUrl);
    if (options.approvalPrincipalSecret.length < 32)
      throw new Error(
        "TAX_AUTHORITY_APPROVAL_PRINCIPAL_CONFIGURATION_REQUIRED",
      );
    if (
      options.approvalPrincipalSecret ===
      (process.env.TAX_AUTOMATION_ENGINE_API_KEY ?? "")
    )
      throw new Error("TAX_AUTHORITY_APPROVAL_PRINCIPAL_MUST_BE_DISTINCT");
    if (
      process.env.NODE_ENV === "production" &&
      options.productionApproved !== true
    )
      throw new Error("TAX_AUTHORITY_APPROVAL_PRODUCTION_APPROVAL_REQUIRED");
    this.#secret = options.approvalPrincipalSecret;
    this.#fetch = options.fetchImpl ?? fetch;
    this.#now = options.now ?? (() => new Date());
  }

  async registerFacturaEApproval(
    input: RegisterFacturaEAuthorityApprovalInput,
  ): Promise<SafeFacturaEAuthorityApprovalReceipt> {
    const parsed = registerApprovalInputSchema.parse(input);
    const path = `/v1/authority/factura-e/intents/${parsed.executionId}/approvals`;
    const body = JSON.stringify({
      version: "factura-e-authority-approval-register-v1",
      workspaceId: parsed.workspaceId,
      intentHash: parsed.intentHash,
      approvalRef: parsed.approvalRef,
      idempotencyKey: parsed.idempotencyKey,
    });
    const encodedPrincipal = Buffer.from(
      JSON.stringify({
        version: "tax-authority-principal-v1",
        workspaceId: parsed.workspaceId,
        actorId: parsed.actorId,
        capability: "factura-e:approval:register",
        method: "POST",
        path,
        bodyHash: createHash("sha256").update(body, "utf8").digest("hex"),
        expiresAt: new Date(this.#now().getTime() + 60_000).toISOString(),
      }),
      "utf8",
    ).toString("base64url");
    let response: Response;
    try {
      response = await this.#fetch(new URL(path, this.#baseUrl), {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "x-tax-authority-principal": encodedPrincipal,
          "x-tax-authority-signature": createHmac("sha256", this.#secret)
            .update(encodedPrincipal)
            .digest("hex"),
        },
        body,
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new TaxAutomationRequestError(
        "TAX_AUTHORITY_APPROVAL_UPSTREAM_UNAVAILABLE",
        503,
      );
    }
    const payload = await boundedJson(response);
    if (!response.ok) {
      const safe = z
        .object({
          error: z
            .string()
            .regex(/^[A-Z0-9_]+$/)
            .max(120),
        })
        .strict()
        .safeParse(payload);
      throw new TaxAutomationRequestError(
        safe.success ? safe.data.error : "TAX_AUTHORITY_APPROVAL_FAILED",
        response.status,
      );
    }
    const receipt = receiptEnvelopeSchema.parse(payload).data;
    if (
      receipt.executionId !== parsed.executionId ||
      receipt.workspaceId !== parsed.workspaceId
    )
      throw new TaxAutomationRequestError(
        "TAX_AUTHORITY_APPROVAL_RESPONSE_SCOPE_MISMATCH",
        502,
      );
    return {
      version: "oa-factura-e-authority-approval-receipt-v1",
      executionId: receipt.executionId,
      workspaceId: receipt.workspaceId,
      intentHash: parsed.intentHash,
      status: "registered",
      replayed: receipt.replayed,
      nextStep: "request_execution_from_motora",
    };
  }
}

/** Generate only on the OA server and persist before calling Tax. */
export function createServerHeldFacturaEApprovalRef(): string {
  return `oa_approval_${randomBytes(24).toString("base64url")}`;
}

/** Deterministic for exact retries; the derivation secret never leaves OA. */
export function deriveServerHeldFacturaEApprovalRef(
  input: Readonly<{
    secret: string;
    workspaceId: string;
    executionId: string;
    actorId: string;
    idempotencyKey: string;
  }>,
): string {
  if (input.secret.length < 32)
    throw new Error("TAX_AUTHORITY_APPROVAL_REF_CONFIGURATION_REQUIRED");
  const scope = JSON.stringify({
    version: "oa-factura-e-approval-ref-v1",
    workspaceId: z.string().uuid().parse(input.workspaceId),
    executionId: z.string().uuid().parse(input.executionId),
    actorId: z.string().min(1).max(300).parse(input.actorId),
    idempotencyKey: idempotencyKeySchema.parse(input.idempotencyKey),
  });
  return `oa_approval_${createHmac("sha256", input.secret)
    .update(scope)
    .digest("base64url")}`;
}

async function boundedJson(response: Response): Promise<unknown> {
  const contentType = response.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim();
  if (contentType !== "application/json")
    throw new TaxAutomationRequestError(
      "TAX_AUTHORITY_APPROVAL_RESPONSE_INVALID",
      502,
    );
  const declared = response.headers.get("content-length");
  if (
    declared !== null &&
    (!/^\d+$/.test(declared) || Number(declared) > MAX_RESPONSE_BYTES)
  ) {
    await response.body?.cancel();
    throw new TaxAutomationRequestError(
      "TAX_AUTHORITY_APPROVAL_RESPONSE_INVALID",
      502,
    );
  }
  if (!response.body) {
    throw new TaxAutomationRequestError(
      "TAX_AUTHORITY_APPROVAL_RESPONSE_INVALID",
      502,
    );
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new TaxAutomationRequestError(
          "TAX_AUTHORITY_APPROVAL_RESPONSE_INVALID",
          502,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  let raw: string;
  try {
    raw = new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))),
    );
  } catch {
    throw new TaxAutomationRequestError(
      "TAX_AUTHORITY_APPROVAL_RESPONSE_INVALID",
      502,
    );
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new TaxAutomationRequestError(
      "TAX_AUTHORITY_APPROVAL_RESPONSE_INVALID",
      502,
    );
  }
}

function safeBaseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("TAX_AUTHORITY_APPROVAL_URL_CONFIGURATION_REQUIRED");
  }
  const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
    url.username !== "" ||
    url.password !== "" ||
    (url.pathname !== "/" && url.pathname !== "") ||
    url.search !== "" ||
    url.hash !== ""
  )
    throw new Error("TAX_AUTHORITY_APPROVAL_URL_CONFIGURATION_REQUIRED");
  return url;
}
