import { createHash } from "node:crypto";
import { z } from "zod";

export const taxDomainEventCertificationRequestSchema = z
  .object({ certificationId: z.uuid() })
  .strict();

export const taxDomainEventCertificationResultSchema = z
  .object({
    version: z.literal("tax-domain-event-certification-result-v1"),
    eventId: z.uuid(),
    proof: z.literal("durable_tax_domain_event_wake"),
  })
  .strict();

export type TaxDomainEventCertificationRefs = Readonly<{
  certificationId: string;
  workspaceRef: string;
  caseRef: string;
  runRef: string;
  sessionRef: string;
  chatRef: string;
  idempotencyKey: string;
  requestHash: string;
}>;

/**
 * Derive isolated, replay-stable references from a synthetic certification ID.
 * These values never contain a customer workspace, taxpayer ID, or provider
 * fact and therefore cannot accidentally target a live TaxCase.
 */
export function taxDomainEventCertificationRefs(
  certificationIdInput: string,
): TaxDomainEventCertificationRefs {
  const certificationId = z.uuid().parse(certificationIdInput);
  const digest = createHash("sha256")
    .update(`tax-domain-event-certification:v1:${certificationId}`)
    .digest("hex");
  return {
    certificationId,
    workspaceRef: certificationId,
    caseRef: `taxcase_e2e_${digest.slice(0, 40)}`,
    runRef: `taxcert_${digest.slice(0, 40)}`,
    sessionRef: `taxcert_session_${digest.slice(0, 32)}`,
    chatRef: `taxcert_chat_${digest.slice(0, 32)}`,
    idempotencyKey: `tax-domain-event-certification:${certificationId}`,
    requestHash: digest,
  };
}

export function taxDomainEventCertificationEnabled(): boolean {
  const deployment = process.env.VERCEL_ENV;
  const safeEnvironment = deployment
    ? deployment === "preview" || deployment === "development"
    : process.env.NODE_ENV !== "production";
  return (
    process.env.OPEN_AGENTS_TAX_DOMAIN_EVENT_CERTIFICATION_ENABLED === "true" &&
    safeEnvironment
  );
}
