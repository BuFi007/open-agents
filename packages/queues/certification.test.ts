import { describe, expect, it } from "bun:test";
import { certifyMixedWorkload, certifyOutboxChaos } from "./index";

describe("mixed BullMQ workload certification", () => {
  it("protects priority work and a quiet workspace from a noisy knowledge tenant", () => {
    const jobs = [
      ...Array.from({ length: 120 }, (_, index) => ({
        id: `noisy_embedding_${index}`,
        workspaceId: "ws_noisy",
        profile: "knowledge-ai" as const,
        queue: index % 3 === 0 ? "projection" : "embedding",
        submittedAtMs: 0,
        durationMs: 100,
      })),
      ...Array.from({ length: 12 }, (_, index) => ({
        id: `quiet_embedding_${index}`,
        workspaceId: "ws_quiet",
        profile: "knowledge-ai" as const,
        queue: "embedding",
        submittedAtMs: 0,
        durationMs: 100,
      })),
      ...Array.from({ length: 24 }, (_, index) => ({
        id: `connector_${index}`,
        workspaceId: index % 2 ? "ws_noisy" : "ws_quiet",
        profile: "source-connectors" as const,
        queue: index % 3 === 0 ? "canonical-write" : "connector-page",
        submittedAtMs: 0,
        durationMs: 50,
      })),
      ...Array.from({ length: 8 }, (_, index) => ({
        id: `ocr_${index}`,
        workspaceId: "ws_noisy",
        profile: "document-ocr" as const,
        queue: "document-ocr",
        submittedAtMs: 0,
        durationMs: 500,
      })),
      ...Array.from({ length: 20 }, (_, index) => ({
        id: `priority_${index}`,
        workspaceId: index % 2 ? "ws_noisy" : "ws_quiet",
        profile: "business-notifications" as const,
        queue: index % 2 ? "invoice" : "notification",
        submittedAtMs: 0,
        durationMs: 25,
      })),
    ];
    const result = certifyMixedWorkload({
      jobs,
      replicas: {
        "source-connectors": 2,
        "document-ocr": 2,
        "knowledge-ai": 2,
        "business-notifications": 1,
      },
      queueWaitSloMs: {
        "connector-page": 200,
        "canonical-write": 200,
        "document-ocr": 2_000,
        embedding: 5_000,
        projection: 5_000,
        invoice: 100,
        notification: 100,
      },
      noisyWorkspaceId: "ws_noisy",
      protectedWorkspaceId: "ws_quiet",
    });
    expect(result.failures).toEqual([]);
    expect(result.noisyTenantIsolated).toBe(true);
    expect(result.prioritySloProtected).toBe(true);
    expect(result.metrics.some((metric) => metric.fairShareDeferrals > 0)).toBe(
      true,
    );
  });

  it("fails closed on missing SLOs, disallowed queues, and deadlines", () => {
    const result = certifyMixedWorkload({
      jobs: [
        {
          id: "bad",
          workspaceId: "ws_noisy",
          profile: "knowledge-ai",
          queue: "invoice",
          submittedAtMs: 0,
          durationMs: 100_000,
        },
      ],
      replicas: { "knowledge-ai": 1 },
      queueWaitSloMs: {},
      noisyWorkspaceId: "ws_noisy",
      protectedWorkspaceId: "ws_quiet",
    });
    expect(result.passed).toBe(false);
    expect(result.failures.join(" ")).toContain("not allowed");
  });

  for (const crashAfter of ["claim", "effect", "none"] as const) {
    it(`replays committed outbox events after ${crashAfter} without loss`, () => {
      const result = certifyOutboxChaos({
        eventIds: Array.from({ length: 100 }, (_, index) => `event_${index}`),
        crashAfter,
      });
      expect(result.passed).toBe(true);
      expect(result.acknowledged).toBe(100);
      expect(result.duplicateEffects).toBe(0);
      expect(result.maxAttempts).toBeLessThanOrEqual(2);
    });
  }
});
