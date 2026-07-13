import { describe, expect, it } from "bun:test";
import { createKnowledgeStore } from "@open-agents/knowledge";
import { scheduleKnowledgeRepairs } from "./knowledge-repair-scheduler";

describe("scheduled knowledge repair", () => {
  it("enqueues stale artifacts once and replays the same lineage on the next tick", async () => {
    const store = createKnowledgeStore();
    const entity = await store.resolveOrCreate({
      workspaceId: "ws_repair",
      kind: "SourceArtifact",
      externalKey: "artifact:invoice-1",
      name: "invoice.pdf",
    });
    const workspace = {
      workspaceId: "ws_repair",
      page: (cursor?: string, limit?: number) =>
        store.page("ws_repair", cursor, limit),
      getSearchProjection: async () => undefined,
    };
    const jobs: unknown[] = [];
    const runtime = {
      async enqueue(job: unknown) {
        jobs.push(job);
        return { bullJobId: "repair-1", replayed: jobs.length > 1 };
      },
    } as never;
    const artifacts = {
      async getArtifact(_workspaceId: string, artifactKey: string) {
        return artifactKey === entity.externalKey
          ? {
              artifactKey,
              connectorId: "gmail_inbox",
              sourceRevision: "revision:invoice-1",
            }
          : undefined;
      },
    };
    const first = await scheduleKnowledgeRepairs({
      workspace: workspace as never,
      artifacts,
      runtime,
      provider: "typesense",
      collection: "workspace_knowledge",
      scanId: "scan-1",
      nowMs: 1_700_000_000_000,
    });
    expect(first).toMatchObject({
      inspected: 1,
      stale: 1,
      enqueued: 1,
      replayed: 0,
    });
    const job = jobs[0] as { payload: Record<string, unknown> };
    expect(job.payload).toMatchObject({
      artifactKey: "artifact:invoice-1",
      sourceRevision: "revision:invoice-1",
      connectionId: "gmail_inbox",
      scanId: "scan-1",
    });
    expect(JSON.stringify(job)).not.toContain("secret");
    const replay = await scheduleKnowledgeRepairs({
      workspace: workspace as never,
      artifacts,
      runtime,
      provider: "typesense",
      collection: "workspace_knowledge",
      scanId: "scan-2",
      nowMs: 1_700_000_000_000,
    });
    expect(replay.replayed).toBe(1);
    expect(replay.enqueued).toBe(0);
  });
});
