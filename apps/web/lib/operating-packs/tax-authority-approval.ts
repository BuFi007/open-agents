import { createHash } from "node:crypto";
import {
  TaxAuthorityApprovalClient,
  deriveServerHeldFacturaEApprovalRef,
  type SafeFacturaEAuthorityApprovalReceipt,
} from "@open-agents/tax-automation";
import { z } from "zod";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const HumanFacturaEAuthorityApprovalSchema = z
  .object({
    version: z.literal("oa-factura-e-human-approval-v1"),
    decision: z.literal("approved"),
    acknowledgement: z.literal("frozen_intent_hash_reviewed"),
    executionId: z.string().uuid(),
    workspaceId: z.string().uuid(),
    intentHash: sha256Schema,
  })
  .strict();

export type HumanFacturaEAuthorityApproval = z.infer<
  typeof HumanFacturaEAuthorityApprovalSchema
>;

type Fetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

type Environment = Readonly<Record<string, string | undefined>>;

export type HumanFacturaEAuthorityApprovalRuntime = Readonly<{
  environment?: Environment;
  fetchImpl?: Fetch;
  now?: () => Date;
}>;

/**
 * Convert one authenticated, grant-scoped human decision into Tax's narrow
 * one-use approval. Signing and reference-derivation keys remain server-only.
 */
export async function registerHumanFacturaEAuthorityApproval(
  input: HumanFacturaEAuthorityApproval & Readonly<{ actorId: string }>,
  runtime: HumanFacturaEAuthorityApprovalRuntime = {},
): Promise<SafeFacturaEAuthorityApprovalReceipt> {
  const { actorId: untrustedActorId, ...decision } = input;
  const parsed = HumanFacturaEAuthorityApprovalSchema.parse(decision);
  const actorId = z.string().min(1).max(300).parse(untrustedActorId);
  const environment = runtime.environment ?? process.env;
  const principalSecret =
    environment.TAX_ENGINE_OPEN_AGENTS_APPROVAL_PRINCIPAL_HMAC_SECRET ?? "";
  const approvalRefSecret =
    environment.OPEN_AGENTS_TAX_APPROVAL_REF_HMAC_SECRET ?? "";
  assertIsolatedApprovalSecrets(
    principalSecret,
    approvalRefSecret,
    environment,
  );
  if (
    environment.NODE_ENV === "production" &&
    environment.OPEN_AGENTS_TAX_AUTHORITY_PRODUCTION_APPROVED !== "true"
  )
    throw new Error("TAX_AUTHORITY_APPROVAL_PRODUCTION_APPROVAL_REQUIRED");

  const idempotencyKey = approvalIdempotencyKey({
    workspaceId: parsed.workspaceId,
    executionId: parsed.executionId,
    intentHash: parsed.intentHash,
    actorId,
  });
  const approvalRef = deriveServerHeldFacturaEApprovalRef({
    secret: approvalRefSecret,
    workspaceId: parsed.workspaceId,
    executionId: parsed.executionId,
    actorId,
    idempotencyKey,
  });
  const client = new TaxAuthorityApprovalClient({
    baseUrl: environment.TAX_AUTOMATION_ENGINE_URL ?? "",
    approvalPrincipalSecret: principalSecret,
    fetchImpl: runtime.fetchImpl,
    now: runtime.now,
    productionApproved:
      environment.OPEN_AGENTS_TAX_AUTHORITY_PRODUCTION_APPROVED === "true",
  });
  return client.registerFacturaEApproval({
    executionId: parsed.executionId,
    workspaceId: parsed.workspaceId,
    intentHash: parsed.intentHash,
    approvalRef,
    actorId,
    idempotencyKey,
  });
}

function approvalIdempotencyKey(
  input: Readonly<{
    workspaceId: string;
    executionId: string;
    intentHash: string;
    actorId: string;
  }>,
): string {
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        version: "oa-factura-e-human-approval-idempotency-v1",
        workspaceId: input.workspaceId,
        executionId: input.executionId,
        intentHash: input.intentHash,
        actorId: input.actorId,
      }),
      "utf8",
    )
    .digest("hex");
  return `oa-human-approval:${digest}`;
}

function assertIsolatedApprovalSecrets(
  principalSecret: string,
  approvalRefSecret: string,
  environment: Environment,
): void {
  const otherSecrets = [
    environment.TAX_AUTOMATION_ENGINE_API_KEY,
    environment.TAX_AUTOMATION_ENGINE_AGENT_PRINCIPAL_HMAC_SECRET,
    environment.BUFI_AGENT_TOOL_BROKER_SECRET,
    environment.OPEN_AGENTS_BUFI_INGRESS_SECRET,
  ];
  if (
    principalSecret.length < 32 ||
    approvalRefSecret.length < 32 ||
    principalSecret === approvalRefSecret ||
    otherSecrets.includes(principalSecret) ||
    otherSecrets.includes(approvalRefSecret)
  )
    throw new Error("TAX_AUTHORITY_APPROVAL_SECRET_CONFIGURATION_REQUIRED");
}
