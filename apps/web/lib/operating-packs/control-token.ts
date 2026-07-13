import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

export const operatingPackControlCheckpoints = [
  "before_agents",
  "before_join",
] as const;

export type OperatingPackControlCheckpoint =
  (typeof operatingPackControlCheckpoints)[number];

export function getOperatingPackControlToken(
  executionId: string,
  checkpoint: OperatingPackControlCheckpoint,
): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret)
    throw new Error("BETTER_AUTH_SECRET is required for workflow controls");
  const digest = bytesToHex(
    hmac(
      sha256,
      utf8ToBytes(secret),
      utf8ToBytes(`operating-pack-control:v1:${executionId}:${checkpoint}`),
    ),
  );
  return `op_control_${digest}`;
}

export function parseOperatingPackControlId(
  value: string | null,
): OperatingPackControlCheckpoint | null {
  if (!value?.startsWith("control:")) return null;
  const checkpoint = value.slice("control:".length);
  return operatingPackControlCheckpoints.includes(
    checkpoint as OperatingPackControlCheckpoint,
  )
    ? (checkpoint as OperatingPackControlCheckpoint)
    : null;
}
