import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

export const TAX_SETTLEMENT_SERVICE_ACTOR_ID =
  "00000000-0000-4000-8000-000000000309";

export function getTaxSettlementHookToken(executionId: string): string {
  return getTaxWorkflowWakeHookToken(executionId);
}

/**
 * One durable TaxCase wake channel. Settlement is one source of progress;
 * ARCA, Reclaim, consent, accountant, and evidence events use the same hook
 * without inventing a second workflow or payment path.
 */
export function getTaxWorkflowWakeHookToken(executionId: string): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret)
    throw new Error("BETTER_AUTH_SECRET is required for tax settlement hooks");
  const digest = bytesToHex(
    hmac(
      sha256,
      utf8ToBytes(secret),
      utf8ToBytes(`tax-settlement-hook:v1:${executionId}`),
    ),
  );
  return `tax_settlement_${digest}`;
}
