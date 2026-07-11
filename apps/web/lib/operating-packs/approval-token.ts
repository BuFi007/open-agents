import { createHmac } from "node:crypto";

export function getOperatingPackApprovalToken(executionId: string): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret)
    throw new Error("BETTER_AUTH_SECRET is required for workflow approvals");
  const digest = createHmac("sha256", secret)
    .update(`operating-pack-approval:v1:${executionId}`)
    .digest("base64url");
  return `op_approval_${digest}`;
}
