import type {
  HarnessAgentAdapter,
  HarnessAgentAdapterSession,
  HarnessAgentStartOptions,
} from "@ai-sdk/harness/agent";

const ACQUIRE_TIMEOUT_MS = 10_000;
const STALE_LEASE_MS = 30_000;

const ACQUIRE_SCRIPT = `
const fs = require("node:fs/promises");
const net = require("node:net");

const port = Number(process.env.OPEN_AGENTS_BRIDGE_PORT);
const sessionId = process.env.OPEN_AGENTS_HARNESS_SESSION_ID;
const timeoutMs = Number(process.env.OPEN_AGENTS_BRIDGE_LEASE_TIMEOUT_MS);
const staleLeaseMs = Number(process.env.OPEN_AGENTS_BRIDGE_STALE_LEASE_MS);
const leaseRoot = "/tmp/open-agents-harness/bridge-port-leases";
const leasePath = leaseRoot + "/" + port;
const ownerPath = leasePath + "/owner";
const deadline = Date.now() + timeoutMs;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isPortAvailable = () =>
  new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen(port, "0.0.0.0", () => {
      server.close(() => resolve(true));
    });
  });

await fs.mkdir(leaseRoot, { recursive: true });

let acquired = false;
while (!acquired) {
  try {
    await fs.mkdir(leasePath);
    await fs.writeFile(ownerPath, sessionId);
    acquired = true;
    break;
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }

  const owner = await fs.readFile(ownerPath, "utf8").catch(() => "");
  if (owner === sessionId) {
    process.stdout.write("reused");
    process.exit(0);
  }

  const lease = await fs.stat(leasePath).catch(() => undefined);
  const isStale = lease && Date.now() - lease.mtimeMs >= staleLeaseMs;
  if (isStale && (await isPortAvailable())) {
    await fs.unlink(ownerPath).catch(() => {});
    await fs.rmdir(leasePath).catch(() => {});
    continue;
  }

  if (Date.now() >= deadline) {
    throw new Error("Timed out waiting for bridge port " + port);
  }
  await delay(100);
}

while (!(await isPortAvailable())) {
  if (Date.now() >= deadline) {
    throw new Error("Timed out waiting for bridge port " + port + " to be released");
  }
  await delay(100);
}
`;

const RELEASE_SCRIPT = `
const fs = require("node:fs/promises");

const port = Number(process.env.OPEN_AGENTS_BRIDGE_PORT);
const sessionId = process.env.OPEN_AGENTS_HARNESS_SESSION_ID;
const leasePath = "/tmp/open-agents-harness/bridge-port-leases/" + port;
const ownerPath = leasePath + "/owner";
const owner = await fs.readFile(ownerPath, "utf8").catch(() => "");

if (owner === sessionId) {
  await fs.unlink(ownerPath).catch(() => {});
  await fs.rmdir(leasePath).catch(() => {});
}
`;

export function withSandboxBridgePortLease(
  adapter: HarnessAgentAdapter,
): HarnessAgentAdapter {
  return {
    ...adapter,
    doStart: async (options) => {
      const bridgePort = options.sandboxSession.ports[0];
      if (bridgePort === undefined) {
        return adapter.doStart(options);
      }

      try {
        await acquireBridgePortLease(options, bridgePort);
        const session = await adapter.doStart(options);
        return withBridgePortLeaseRelease(session, options, bridgePort);
      } catch (error) {
        await releaseBridgePortLease(options, bridgePort);
        throw error;
      }
    },
  };
}

async function acquireBridgePortLease(
  options: HarnessAgentStartOptions,
  bridgePort: number,
): Promise<void> {
  const result = await options.sandboxSession.restricted().run({
    command: `node --input-type=module -e ${shellQuote(ACQUIRE_SCRIPT)}`,
    env: getLeaseEnv(options.sessionId, bridgePort),
    abortSignal: options.abortSignal,
  });

  if (result.exitCode !== 0) {
    throw new Error(
      `Failed to acquire harness bridge port ${bridgePort}: ${result.stderr.trim() || "unknown error"}`,
    );
  }
}

function withBridgePortLeaseRelease(
  session: HarnessAgentAdapterSession,
  options: HarnessAgentStartOptions,
  bridgePort: number,
): HarnessAgentAdapterSession {
  return {
    ...session,
    doDestroy: async () => {
      try {
        await session.doDestroy();
      } finally {
        await releaseBridgePortLease(options, bridgePort);
      }
    },
    doStop: async () => {
      try {
        return await session.doStop();
      } finally {
        await releaseBridgePortLease(options, bridgePort);
      }
    },
  };
}

async function releaseBridgePortLease(
  options: HarnessAgentStartOptions,
  bridgePort: number,
): Promise<void> {
  await Promise.resolve(
    options.sandboxSession.restricted().run({
      command: `node --input-type=module -e ${shellQuote(RELEASE_SCRIPT)}`,
      env: getLeaseEnv(options.sessionId, bridgePort),
    }),
  ).catch(() => {});
}

function getLeaseEnv(
  sessionId: string,
  bridgePort: number,
): Record<string, string> {
  return {
    OPEN_AGENTS_BRIDGE_PORT: String(bridgePort),
    OPEN_AGENTS_HARNESS_SESSION_ID: sessionId,
    OPEN_AGENTS_BRIDGE_LEASE_TIMEOUT_MS: String(ACQUIRE_TIMEOUT_MS),
    OPEN_AGENTS_BRIDGE_STALE_LEASE_MS: String(STALE_LEASE_MS),
  };
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
