export type WorkerProfile = {
  name:
    | "source-connectors"
    | "document-ocr"
    | "knowledge-ai"
    | "business-notifications";
  allowedQueues: readonly string[];
  maxReplicas: number;
  concurrencyPerReplica: number;
  workspaceConcurrency: number;
  deadlineMs: number;
  dlqMaxEntries: number;
  priority: "high" | "normal" | "low";
};

export type WorkerAdmission = {
  profile: WorkerProfile["name"];
  workspaceId: string;
  queue: string;
  admitted: boolean;
  reason?: string;
  totalConcurrency: number;
};

export type JobFailureClass = "retryable" | "unrecoverable" | "deadline";

export type DlqEntry = {
  jobId: string;
  workspaceId: string;
  profile: WorkerProfile["name"];
  queue: string;
  failureClass: JobFailureClass;
  errorCode: string;
  attempts: number;
  payloadHash: string;
  stackHash?: string;
  atMs: number;
};

const ID = /^[a-zA-Z0-9][a-zA-Z0-9:_./-]{1,191}$/;
const HASH = /^sha256:[a-f0-9]{64}$/;

export const workerProfiles: readonly WorkerProfile[] = [
  {
    name: "source-connectors",
    allowedQueues: ["connector-page", "source-event", "canonical-write"],
    maxReplicas: 4,
    concurrencyPerReplica: 8,
    workspaceConcurrency: 4,
    deadlineMs: 60_000,
    dlqMaxEntries: 1000,
    priority: "normal",
  },
  {
    name: "document-ocr",
    allowedQueues: ["document-ocr", "image-convert"],
    maxReplicas: 3,
    concurrencyPerReplica: 3,
    workspaceConcurrency: 2,
    deadlineMs: 180_000,
    dlqMaxEntries: 500,
    priority: "normal",
  },
  {
    name: "knowledge-ai",
    allowedQueues: ["enrichment", "embedding", "projection", "repair"],
    maxReplicas: 4,
    concurrencyPerReplica: 6,
    workspaceConcurrency: 3,
    deadlineMs: 90_000,
    dlqMaxEntries: 1000,
    priority: "low",
  },
  {
    name: "business-notifications",
    allowedQueues: ["invoice", "payable", "notification", "report"],
    maxReplicas: 4,
    concurrencyPerReplica: 10,
    workspaceConcurrency: 6,
    deadlineMs: 30_000,
    dlqMaxEntries: 500,
    priority: "high",
  },
];

function requireId(name: string, value: string): void {
  if (!ID.test(value)) throw new Error(`invalid worker profile ${name}`);
}

function profileByName(name: WorkerProfile["name"]): WorkerProfile {
  const profile = workerProfiles.find((candidate) => candidate.name === name);
  if (!profile) throw new Error(`unknown worker profile: ${name}`);
  return profile;
}

export function evaluateWorkerAdmission(input: {
  profile: WorkerProfile["name"];
  workspaceId: string;
  queue: string;
  activeForWorkspace: number;
  replicas: number;
}): WorkerAdmission {
  requireId("workspaceId", input.workspaceId);
  requireId("queue", input.queue);
  const profile = profileByName(input.profile);
  const totalConcurrency =
    Math.min(input.replicas, profile.maxReplicas) *
    profile.concurrencyPerReplica;
  if (!profile.allowedQueues.includes(input.queue))
    return {
      profile: profile.name,
      workspaceId: input.workspaceId,
      queue: input.queue,
      admitted: false,
      reason: "queue not allowed for worker profile",
      totalConcurrency,
    };
  if (input.replicas < 1 || input.replicas > profile.maxReplicas)
    return {
      profile: profile.name,
      workspaceId: input.workspaceId,
      queue: input.queue,
      admitted: false,
      reason: "replica count exceeds profile budget",
      totalConcurrency,
    };
  if (input.activeForWorkspace >= profile.workspaceConcurrency)
    return {
      profile: profile.name,
      workspaceId: input.workspaceId,
      queue: input.queue,
      admitted: false,
      reason: "workspace fair-share limit reached",
      totalConcurrency,
    };
  return {
    profile: profile.name,
    workspaceId: input.workspaceId,
    queue: input.queue,
    admitted: true,
    totalConcurrency,
  };
}

export function classifyJobFailure(input: {
  status?: number;
  timedOut?: boolean;
  retryable?: boolean;
}): JobFailureClass {
  if (input.timedOut) return "deadline";
  if (input.retryable === false) return "unrecoverable";
  if (
    input.status &&
    input.status >= 400 &&
    input.status < 500 &&
    input.status !== 429
  )
    return "unrecoverable";
  return "retryable";
}

export function createDlqEntry(input: DlqEntry): DlqEntry {
  requireId("jobId", input.jobId);
  requireId("workspaceId", input.workspaceId);
  requireId("queue", input.queue);
  requireId("errorCode", input.errorCode);
  if (!HASH.test(input.payloadHash))
    throw new Error("DLQ payload must be represented by a hash");
  if (input.stackHash && !HASH.test(input.stackHash))
    throw new Error("DLQ stack must be represented by a hash");
  if (!Number.isInteger(input.attempts) || input.attempts < 1)
    throw new Error("DLQ attempts are required");
  if (input.atMs <= 0) throw new Error("DLQ timestamp is required");
  profileByName(input.profile);
  return { ...input };
}
