import { z } from "zod";

const modeSchema = z.enum(["relay", "source", "knowledge", "all"]);
export type KnowledgeWorkerMode = z.infer<typeof modeSchema>;

export type KnowledgeWorkerConfig = Readonly<{
  mode: KnowledgeWorkerMode;
  workerId: string;
  port: number;
  databaseUrl: string;
  redisUrl: string;
  namespace: string;
  replicaCount: number;
  workspaceIds: readonly string[];
  relayIntervalMs: number;
  relayBatchSize: number;
  telemetryUrl: string;
  telemetrySecret: string;
  telemetryIntervalMs: number;
  typesenseUrl: string | null;
  typesenseApiKey: string | null;
  typesenseCollection: string;
  alertWebhookUrl: string | null;
  alertWebhookSecret: string | null;
}>;

const id = z
  .string()
  .min(2)
  .max(191)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9:_./-]+$/);

export function parseKnowledgeWorkerConfig(
  environment: Readonly<Record<string, string | undefined>>,
): KnowledgeWorkerConfig {
  const mode = modeSchema.parse(environment.KNOWLEDGE_WORKER_MODE ?? "all");
  const production = environment.NODE_ENV === "production";
  const workspaceIds = uniqueIds(environment.KNOWLEDGE_WORKSPACE_IDS ?? "");
  if ((mode === "relay" || mode === "all") && workspaceIds.length === 0)
    throw new Error("KNOWLEDGE_WORKSPACE_IDS is required for relay mode");
  const databaseUrl = requiredUrl(environment.DATABASE_URL, "DATABASE_URL", [
    "postgres:",
    "postgresql:",
  ]);
  const redisUrl = requiredUrl(
    environment.REDIS_URL ?? environment.KV_URL,
    "REDIS_URL",
    ["redis:", "rediss:"],
  );
  const telemetryUrl = requiredUrl(
    environment.OPEN_AGENTS_QUEUE_TELEMETRY_URL,
    "OPEN_AGENTS_QUEUE_TELEMETRY_URL",
    ["https:", ...(production ? [] : ["http:"])],
  );
  const telemetrySecret = environment.OPEN_AGENTS_QUEUE_TELEMETRY_SECRET ?? "";
  if (telemetrySecret.length < 32)
    throw new Error("OPEN_AGENTS_QUEUE_TELEMETRY_SECRET is not configured");

  const needsKnowledge = mode === "knowledge" || mode === "all";
  const typesenseUrl = environment.TYPESENSE_URL
    ? requiredUrl(environment.TYPESENSE_URL, "TYPESENSE_URL", [
        "https:",
        ...(production ? [] : ["http:"]),
      ])
    : null;
  const typesenseApiKey = environment.TYPESENSE_API_KEY ?? null;
  if (
    needsKnowledge &&
    (!typesenseUrl || !typesenseApiKey || typesenseApiKey.length < 16)
  )
    throw new Error("Typesense is required for knowledge worker mode");

  const alertWebhookUrl = environment.QUEUE_ALERT_WEBHOOK_URL
    ? requiredUrl(
        environment.QUEUE_ALERT_WEBHOOK_URL,
        "QUEUE_ALERT_WEBHOOK_URL",
        ["https:", ...(production ? [] : ["http:"])],
      )
    : null;
  const alertWebhookSecret = environment.QUEUE_ALERT_WEBHOOK_SECRET ?? null;
  if (
    alertWebhookUrl &&
    (!alertWebhookSecret || alertWebhookSecret.length < 32)
  )
    throw new Error(
      "QUEUE_ALERT_WEBHOOK_SECRET is required for alert delivery",
    );

  return {
    mode,
    workerId: id.parse(
      environment.KNOWLEDGE_WORKER_ID ??
        `knowledge-worker-${crypto.randomUUID()}`,
    ),
    port: integer(environment.PORT, 3001, 1, 65_535),
    databaseUrl,
    redisUrl,
    namespace: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{3,80}$/)
      .parse(environment.BULLMQ_NAMESPACE ?? "bufi-knowledge"),
    replicaCount: integer(environment.WORKER_REPLICA_COUNT, 1, 1, 64),
    workspaceIds,
    relayIntervalMs: integer(
      environment.OUTBOX_RELAY_INTERVAL_MS,
      1_000,
      100,
      60_000,
    ),
    relayBatchSize: integer(environment.OUTBOX_RELAY_BATCH_SIZE, 100, 1, 1_000),
    telemetryUrl,
    telemetrySecret,
    telemetryIntervalMs: integer(
      environment.QUEUE_TELEMETRY_INTERVAL_MS,
      15_000,
      1_000,
      300_000,
    ),
    typesenseUrl,
    typesenseApiKey,
    typesenseCollection: id.parse(
      environment.TYPESENSE_COLLECTION ?? "workspace_knowledge",
    ),
    alertWebhookUrl,
    alertWebhookSecret,
  };
}

function uniqueIds(value: string): readonly string[] {
  const values = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => id.parse(item));
  if (new Set(values).size !== values.length)
    throw new Error("KNOWLEDGE_WORKSPACE_IDS contains duplicates");
  if (values.length > 1_000)
    throw new Error("KNOWLEDGE_WORKSPACE_IDS exceeds 1000 workspaces");
  return values;
}

function integer(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum)
    throw new Error(
      `Integer configuration must be between ${minimum} and ${maximum}`,
    );
  return parsed;
}

function requiredUrl(
  value: string | undefined,
  name: string,
  protocols: readonly string[],
): string {
  if (!value) throw new Error(`${name} is required`);
  const url = new URL(value);
  const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (!protocols.includes(url.protocol) || (url.protocol === "http:" && !local))
    throw new Error(`${name} protocol is not allowed`);
  return url.toString();
}
