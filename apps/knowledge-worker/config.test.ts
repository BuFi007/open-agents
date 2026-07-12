import { describe, expect, test } from "bun:test";
import { parseKnowledgeWorkerConfig } from "./config";

const base = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://worker:password@database.test:5432/open_agents",
  REDIS_URL: "rediss://redis.test:6379",
  OPEN_AGENTS_QUEUE_TELEMETRY_URL:
    "https://open-agents.test/api/internal/queue-telemetry",
  OPEN_AGENTS_QUEUE_TELEMETRY_SECRET:
    "telemetry-secret-at-least-thirty-two-characters",
  KNOWLEDGE_WORKSPACE_IDS: "workspace-a,workspace-b",
  TYPESENSE_URL: "https://typesense.test",
  TYPESENSE_API_KEY: "typesense-key-at-least-sixteen",
};

describe("knowledge worker configuration", () => {
  test("builds separate relay and knowledge deployment profiles", () => {
    expect(
      parseKnowledgeWorkerConfig({
        ...base,
        KNOWLEDGE_WORKER_MODE: "relay",
        TYPESENSE_URL: undefined,
        TYPESENSE_API_KEY: undefined,
      }),
    ).toMatchObject({
      mode: "relay",
      workspaceIds: ["workspace-a", "workspace-b"],
      typesenseUrl: null,
    });
    expect(
      parseKnowledgeWorkerConfig({
        ...base,
        KNOWLEDGE_WORKER_MODE: "knowledge",
        KNOWLEDGE_WORKSPACE_IDS: undefined,
      }),
    ).toMatchObject({ mode: "knowledge", workspaceIds: [] });
  });

  test("fails closed without relay scope, telemetry, or knowledge providers", () => {
    expect(() =>
      parseKnowledgeWorkerConfig({
        ...base,
        KNOWLEDGE_WORKER_MODE: "relay",
        KNOWLEDGE_WORKSPACE_IDS: "",
      }),
    ).toThrow("KNOWLEDGE_WORKSPACE_IDS");
    expect(() =>
      parseKnowledgeWorkerConfig({
        ...base,
        OPEN_AGENTS_QUEUE_TELEMETRY_SECRET: "weak",
      }),
    ).toThrow("TELEMETRY_SECRET");
    expect(() =>
      parseKnowledgeWorkerConfig({
        ...base,
        KNOWLEDGE_WORKER_MODE: "knowledge",
        TYPESENSE_API_KEY: undefined,
      }),
    ).toThrow("Typesense");
  });

  test("rejects duplicate tenants and non-TLS remote services", () => {
    expect(() =>
      parseKnowledgeWorkerConfig({
        ...base,
        KNOWLEDGE_WORKSPACE_IDS: "workspace-a,workspace-a",
      }),
    ).toThrow("duplicates");
    expect(() =>
      parseKnowledgeWorkerConfig({ ...base, REDIS_URL: "http://redis.test" }),
    ).toThrow("protocol");
  });
});
