import { createPostgresConnectorRepository } from "@open-agents/connectors";
import {
  createAiGatewayKnowledgeEmbeddingProvider,
  createPostgresKnowledgeRepository,
  createTypesenseKnowledgeProjectionProvider,
} from "@open-agents/knowledge";
import {
  createBullMqRuntime,
  createKnowledgeAiProcessor,
  createKnowledgeCanonicalWriteProcessor,
  createKnowledgeEmbeddingProcessor,
  createKnowledgeEnrichmentProcessor,
  createKnowledgeRepairProcessor,
  createKnowledgeSearchProjectionProcessor,
  createQueueTelemetryHttpSink,
  createQueueTelemetryReporter,
  relayKnowledgeOutbox,
  type BullMqRuntimeJob,
  type QueueTelemetryExport,
  type WorkerProfile,
} from "@open-agents/queues";
import { parseKnowledgeWorkerConfig } from "./config";

const config = parseKnowledgeWorkerConfig(process.env);
const knowledge = createPostgresKnowledgeRepository({
  connectionString: config.databaseUrl,
  maxConnections: 8,
});
const connectors = createPostgresConnectorRepository({
  connectionString: config.databaseUrl,
  maxConnections: 4,
});
const telemetry = createQueueTelemetryReporter({
  sink: createQueueTelemetryHttpSink({
    endpoint: config.telemetryUrl,
    secret: config.telemetrySecret,
    deploymentProtectionBypassSecret:
      config.deploymentProtectionBypassSecret ?? undefined,
  }),
  policy: {
    queueWaitSloMs: 5_000,
    processingSloMs: 30_000,
    retryRate: 0.05,
    deadLetters: 0,
    inFlight: 100,
  },
  onDelivered: async (exported) => {
    if (exported.alerts.length > 0) await deliverAlerts(exported);
  },
  onDeliveryFailed: (failure) => {
    console.error(
      JSON.stringify({
        level: "error",
        event: "queue.telemetry.delivery_failed",
        ...failure,
      }),
    );
  },
});
const runtime = createBullMqRuntime({
  redisUrl: config.redisUrl,
  namespace: config.namespace,
  replicaCount: config.replicaCount,
  trace: (fact) => telemetry.record(fact),
});

const canonical = createKnowledgeCanonicalWriteProcessor({
  artifacts: connectors,
  forWorkspace: (workspaceId) => knowledge.forWorkspace(workspaceId),
});
const processors: Partial<
  Record<
    WorkerProfile["name"],
    (job: BullMqRuntimeJob, signal: AbortSignal) => Promise<void>
  >
> = {};
if (config.mode === "source" || config.mode === "all")
  processors["source-connectors"] = canonical;
if (config.mode === "knowledge" || config.mode === "all") {
  const embedding = createKnowledgeEmbeddingProcessor({
    forWorkspace: (workspaceId) => knowledge.forWorkspace(workspaceId),
    provider: createAiGatewayKnowledgeEmbeddingProvider(),
  });
  const enrichment = createKnowledgeEnrichmentProcessor({
    artifacts: connectors,
    forWorkspace: (workspaceId) => knowledge.forWorkspace(workspaceId),
  });
  const projection = createKnowledgeSearchProjectionProcessor({
    forWorkspace: (workspaceId) => knowledge.forWorkspace(workspaceId),
    provider: createTypesenseKnowledgeProjectionProvider({
      baseUrl: config.typesenseUrl!,
      apiKey: config.typesenseApiKey!,
      collection: config.typesenseCollection,
    }),
  });
  const repair = createKnowledgeRepairProcessor({
    canonical,
    enrichment,
    embedding,
    projection,
  });
  processors["knowledge-ai"] = createKnowledgeAiProcessor({
    canonical,
    enrichment,
    embedding,
    projection,
    repair,
  });
}

let stopping = false;
let relayRunning = false;
let lastRelayAt: string | null = null;
let lastRelayErrorCode: string | null = null;
let relayPublished = 0;
await runtime.start(processors);

const relayTimer =
  config.mode === "relay" || config.mode === "all"
    ? setInterval(() => void relayOnce(), config.relayIntervalMs)
    : null;
const telemetryTimer = setInterval(
  () => void telemetry.flush(),
  config.telemetryIntervalMs,
);
if (relayTimer) void relayOnce();

const server = Bun.serve({
  port: config.port,
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/livez")
      return Response.json({ live: !stopping, mode: config.mode });
    if (path === "/readyz") {
      const health = await runtime.health();
      const relayFresh =
        !relayTimer ||
        (lastRelayAt !== null &&
          Date.now() - Date.parse(lastRelayAt) <= config.relayIntervalMs * 5);
      const ready =
        !stopping && health.ready && relayFresh && lastRelayErrorCode === null;
      return Response.json(
        {
          ready,
          mode: config.mode,
          redis: health.redis,
          workers: health.workers,
          relay: {
            configuredWorkspaces: config.workspaceIds.length,
            running: relayRunning,
            lastRelayAt,
            errorCode: lastRelayErrorCode,
            published: relayPublished,
          },
          telemetry: telemetry.pending(),
        },
        { status: ready ? 200 : 503 },
      );
    }
    return Response.json({ error: "NOT_FOUND" }, { status: 404 });
  },
});

console.log(
  JSON.stringify({
    level: "info",
    event: "knowledge_worker.started",
    mode: config.mode,
    workerId: config.workerId,
    port: server.port,
    configuredWorkspaces: config.workspaceIds.length,
  }),
);

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

async function relayOnce(): Promise<void> {
  if (stopping || relayRunning) return;
  relayRunning = true;
  try {
    for (const workspaceId of config.workspaceIds) {
      const result = await relayKnowledgeOutbox({
        workspace: knowledge.forWorkspace(workspaceId),
        runtime,
        workerId: config.workerId,
        limit: config.relayBatchSize,
      });
      relayPublished += result.published;
      if (result.failures.length > 0)
        console.warn(
          JSON.stringify({
            level: "warn",
            event: "knowledge_outbox.delivery_failures",
            workspaceId,
            count: result.failures.length,
            errorCodes: [
              ...new Set(result.failures.map((item) => item.errorCode)),
            ],
          }),
        );
    }
    lastRelayAt = new Date().toISOString();
    lastRelayErrorCode = null;
  } catch {
    lastRelayErrorCode = "OUTBOX_RELAY_CYCLE_FAILED";
    console.error(
      JSON.stringify({
        level: "error",
        event: "knowledge_outbox.cycle_failed",
        errorCode: lastRelayErrorCode,
      }),
    );
  } finally {
    relayRunning = false;
  }
}

async function deliverAlerts(exported: QueueTelemetryExport): Promise<void> {
  if (!(config.alertWebhookUrl && config.alertWebhookSecret)) return;
  try {
    const response = await fetch(config.alertWebhookUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.alertWebhookSecret}`,
        "content-type": "application/json",
        ...(config.deploymentProtectionBypassSecret
          ? {
              "x-vercel-protection-bypass":
                config.deploymentProtectionBypassSecret,
            }
          : {}),
      },
      body: JSON.stringify({
        schemaVersion: 1,
        workspaceId: exported.workspaceId,
        runId: exported.runId,
        exportId: exported.exportId,
        generatedAtMs: exported.generatedAtMs,
        alerts: exported.alerts,
      }),
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error("alert delivery rejected");
  } catch {
    console.error(
      JSON.stringify({
        level: "error",
        event: "queue.alert.delivery_failed",
        workspaceId: exported.workspaceId,
        runId: exported.runId,
        errorCode: "QUEUE_ALERT_DELIVERY_FAILED",
      }),
    );
  }
}

async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  if (relayTimer) clearInterval(relayTimer);
  clearInterval(telemetryTimer);
  server.stop(false);
  await telemetry.close();
  await runtime.close();
  await Promise.all([knowledge.close(), connectors.close()]);
  console.log(
    JSON.stringify({
      level: "info",
      event: "knowledge_worker.stopped",
      signal,
    }),
  );
  process.exit(0);
}
