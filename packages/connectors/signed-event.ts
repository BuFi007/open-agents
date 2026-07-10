import { createHmac, timingSafeEqual } from "node:crypto";
import type { ConnectorEnvironment, ConnectorManifest } from "./manifest";
import { validateConnectorManifest } from "./manifest";

export type ConnectorEventRegistry = {
  getByDeploymentId(deploymentId: string): Promise<ConnectorManifest | undefined>;
  hasSeenEvent(eventId: string): Promise<boolean>;
  markSeenEvent(eventId: string): Promise<void>;
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
    .update(`${input.timestampMs}.${input.eventId}.${input.deploymentId}.${input.rawBody}`)
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
  if (!input.deploymentId || !EVENT_ID.test(input.eventId)) throw new Error("invalid connector event identity");
  if (Math.abs(nowMs - input.timestampMs) > replayWindowMs) throw new Error("connector event timestamp is outside replay window");
  const manifest = await registry.getByDeploymentId(input.deploymentId);
  if (!manifest) throw new Error("unknown connector deployment");
  const valid = validateConnectorManifest(manifest);
  if (valid.environment !== input.environment) throw new Error("connector event environment mismatch");
  if (await registry.hasSeenEvent(input.eventId)) throw new Error("duplicate connector event");
  const secret = await secretForDeployment(input.deploymentId);
  if (!secret || secret.length < 16) throw new Error("missing connector event signing secret");
  if (!equalHex(input.signature, sign(secret, input))) throw new Error("invalid connector event signature");
  await registry.markSeenEvent(input.eventId);
  return valid;
}
