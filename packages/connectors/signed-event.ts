import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { ConnectorEnvironment, ConnectorManifest } from "./manifest";
import { validateConnectorManifest } from "./manifest";

export type ConnectorEventRegistry = {
  getByDeploymentId(
    deploymentId: string,
  ): Promise<ConnectorManifest | undefined>;
  consumeEvent(input: ConnectorEventReceiptInput): Promise<boolean>;
};

export type ConnectorEventReceiptInput = {
  deploymentId: string;
  workspaceId: string;
  eventId: string;
  timestampMs: number;
  bodyHash: string;
};

export type SignedConnectorEventInput = {
  deploymentId: string;
  environment: ConnectorEnvironment;
  eventId: string;
  timestampMs: number;
  rawBody: string;
  signature: string;
};

const EVENT_ID = /^[a-zA-Z0-9][a-zA-Z0-9:._/-]{7,191}$/;

function sign(secret: string, input: SignedConnectorEventInput): string {
  return createHmac("sha256", secret)
    .update(
      `${input.timestampMs}.${input.eventId}.${input.deploymentId}.${input.rawBody}`,
    )
    .digest("hex");
}

function equalHex(a: string, b: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(a) || !/^[a-f0-9]{64}$/i.test(b)) return false;
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function verifySignedConnectorEvent(
  input: SignedConnectorEventInput,
  registry: ConnectorEventRegistry,
  secretForDeployment: (deploymentId: string) => Promise<string | undefined>,
  nowMs = Date.now(),
  replayWindowMs = 5 * 60 * 1000,
): Promise<ConnectorManifest> {
  if (!EVENT_ID.test(input.deploymentId) || !EVENT_ID.test(input.eventId))
    throw new Error("invalid connector event identity");
  if (!Number.isSafeInteger(input.timestampMs) || input.timestampMs <= 0)
    throw new Error("invalid connector event timestamp");
  if (Buffer.byteLength(input.rawBody, "utf8") > 10 * 1024 * 1024)
    throw new Error("connector event body is too large");
  if (Math.abs(nowMs - input.timestampMs) > replayWindowMs)
    throw new Error("connector event timestamp is outside replay window");
  const manifest = await registry.getByDeploymentId(input.deploymentId);
  if (!manifest) throw new Error("unknown connector deployment");
  const valid = validateConnectorManifest(manifest);
  if (valid.environment !== input.environment)
    throw new Error("connector event environment mismatch");
  const secret = await secretForDeployment(input.deploymentId);
  if (!secret || secret.length < 16)
    throw new Error("missing connector event signing secret");
  if (!equalHex(input.signature, sign(secret, input)))
    throw new Error("invalid connector event signature");
  const receipt = {
    deploymentId: input.deploymentId,
    workspaceId: valid.workspaceId,
    eventId: input.eventId,
    timestampMs: input.timestampMs,
    bodyHash: `sha256:${createHash("sha256").update(input.rawBody).digest("hex")}`,
  };
  if (!(await registry.consumeEvent(receipt)))
    throw new Error("duplicate connector event");
  return valid;
}
