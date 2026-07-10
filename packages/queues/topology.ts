export type QueueProfile = {
  name:
    | "canonical-write"
    | "enrichment"
    | "embedding"
    | "projection"
    | "repair";
  concurrency: number;
  maxAttempts: number;
  backoffMs: number;
  maxDlq: number;
  fairShare: boolean;
};

export type QueueJob = {
  id: string;
  workspaceId: string;
  kind: QueueProfile["name"];
  payload: Readonly<Record<string, unknown>>;
  idempotencyKey: string;
};
export type QueuePlan = {
  profiles: readonly QueueProfile[];
  jobs: readonly QueueJob[];
};

const profiles: readonly QueueProfile[] = [
  {
    name: "canonical-write",
    concurrency: 8,
    maxAttempts: 5,
    backoffMs: 500,
    maxDlq: 1000,
    fairShare: true,
  },
  {
    name: "enrichment",
    concurrency: 32,
    maxAttempts: 4,
    backoffMs: 1000,
    maxDlq: 2000,
    fairShare: true,
  },
  {
    name: "embedding",
    concurrency: 16,
    maxAttempts: 4,
    backoffMs: 2000,
    maxDlq: 1000,
    fairShare: true,
  },
  {
    name: "projection",
    concurrency: 24,
    maxAttempts: 5,
    backoffMs: 500,
    maxDlq: 1000,
    fairShare: true,
  },
  {
    name: "repair",
    concurrency: 2,
    maxAttempts: 3,
    backoffMs: 5000,
    maxDlq: 100,
    fairShare: false,
  },
];

export function createQueuePlan(jobs: readonly QueueJob[]): QueuePlan {
  const ids = new Set<string>();
  for (const job of jobs) {
    if (!job.id || !job.workspaceId || !job.idempotencyKey || ids.has(job.id))
      throw new Error(`Invalid or duplicate queue job: ${job.id}`);
    ids.add(job.id);
    if (!profiles.some((profile) => profile.name === job.kind))
      throw new Error(`Unknown queue profile: ${job.kind}`);
  }
  return { profiles, jobs: [...jobs] };
}
