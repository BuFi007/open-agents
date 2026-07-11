import type { QueueTraceFact } from "./bullmq";
import type { WorkerProfile } from "./worker-profiles";

const DEFAULT_MAX_TRACKED_JOBS = 10_000;

export type QueueTelemetryMetric = {
  profile: WorkerProfile["name"];
  queue: string;
  queued: number;
  completed: number;
  retrying: number;
  deadLettered: number;
  throttled: number;
  inFlight: number;
  p95QueueWaitMs: number;
  p95ProcessingMs: number;
};

export type QueueTelemetryAlert = {
  code:
    | "QUEUE_WAIT_SLO_EXCEEDED"
    | "PROCESSING_SLO_EXCEEDED"
    | "RETRY_RATE_EXCEEDED"
    | "DEAD_LETTERS_PRESENT"
    | "IN_FLIGHT_LIMIT_EXCEEDED";
  profile: WorkerProfile["name"];
  queue: string;
  observed: number;
  threshold: number;
};

export type QueueTelemetrySnapshot = {
  generatedAtMs: number;
  metrics: readonly QueueTelemetryMetric[];
  alerts: readonly QueueTelemetryAlert[];
  trackedJobs: number;
  evictedJobs: number;
};

export type QueueTelemetryPolicy = {
  queueWaitSloMs: number;
  processingSloMs: number;
  retryRate: number;
  deadLetters: number;
  inFlight: number;
};

type JobTiming = {
  key: string;
  queuedAtMs?: number;
  startedAtMs?: number;
};

type MutableMetric = Omit<
  QueueTelemetryMetric,
  "p95QueueWaitMs" | "p95ProcessingMs"
> & {
  queueWaits: number[];
  processingTimes: number[];
};

export type QueueTelemetry = {
  record(fact: QueueTraceFact): void;
  snapshot(policy: QueueTelemetryPolicy): QueueTelemetrySnapshot;
  reset(): void;
};

export function createQueueTelemetry(options?: {
  maxTrackedJobs?: number;
  now?: () => number;
}): QueueTelemetry {
  const maxTrackedJobs = options?.maxTrackedJobs ?? DEFAULT_MAX_TRACKED_JOBS;
  if (!Number.isInteger(maxTrackedJobs) || maxTrackedJobs < 1)
    throw new Error("Queue telemetry maxTrackedJobs must be positive");
  const now = options?.now ?? Date.now;
  const jobs = new Map<string, JobTiming>();
  const metrics = new Map<string, MutableMetric>();
  let evictedJobs = 0;

  const record = (fact: QueueTraceFact): void => {
    const metricKey = `${fact.profile}:${fact.queue}`;
    const metric = metrics.get(metricKey) ?? emptyMetric(fact);
    const jobKey = `${fact.profile}:${fact.workspaceId}:${fact.jobId}`;
    const timing = jobs.get(jobKey) ?? { key: jobKey };

    if (fact.type === "queued") {
      metric.queued += 1;
      timing.queuedAtMs = fact.atMs;
      track(jobs, timing, maxTrackedJobs, () => {
        evictedJobs += 1;
      });
    } else if (fact.type === "started") {
      if (timing.startedAtMs === undefined) metric.inFlight += 1;
      timing.startedAtMs = fact.atMs;
      if (timing.queuedAtMs !== undefined)
        pushBounded(metric.queueWaits, fact.atMs - timing.queuedAtMs);
      track(jobs, timing, maxTrackedJobs, () => {
        evictedJobs += 1;
      });
    } else if (fact.type === "completed") {
      metric.completed += 1;
      finish(metric, timing, fact.atMs);
      jobs.delete(jobKey);
    } else if (fact.type === "retrying") {
      metric.retrying += 1;
      finish(metric, timing, fact.atMs);
      timing.queuedAtMs = fact.atMs;
    } else if (fact.type === "dead-lettered") {
      metric.deadLettered += 1;
      finish(metric, timing, fact.atMs);
      jobs.delete(jobKey);
    } else if (fact.type === "throttled") {
      metric.throttled += 1;
    }
    metrics.set(metricKey, metric);
  };

  return {
    record,
    snapshot(policy) {
      validatePolicy(policy);
      const publicMetrics = [...metrics.values()]
        .map(toMetric)
        .sort(
          (left, right) =>
            left.profile.localeCompare(right.profile) ||
            left.queue.localeCompare(right.queue),
        );
      return {
        generatedAtMs: now(),
        metrics: publicMetrics,
        alerts: publicMetrics.flatMap((metric) => alertsFor(metric, policy)),
        trackedJobs: jobs.size,
        evictedJobs,
      };
    },
    reset() {
      jobs.clear();
      metrics.clear();
      evictedJobs = 0;
    },
  };
}

function emptyMetric(fact: QueueTraceFact): MutableMetric {
  return {
    profile: fact.profile,
    queue: fact.queue,
    queued: 0,
    completed: 0,
    retrying: 0,
    deadLettered: 0,
    throttled: 0,
    inFlight: 0,
    queueWaits: [],
    processingTimes: [],
  };
}

function finish(metric: MutableMetric, timing: JobTiming, atMs: number): void {
  if (timing.startedAtMs === undefined) return;
  metric.inFlight = Math.max(0, metric.inFlight - 1);
  pushBounded(metric.processingTimes, atMs - timing.startedAtMs);
  timing.startedAtMs = undefined;
}

function track(
  jobs: Map<string, JobTiming>,
  timing: JobTiming,
  limit: number,
  onEvict: () => void,
): void {
  jobs.delete(timing.key);
  jobs.set(timing.key, timing);
  while (jobs.size > limit) {
    const oldest = jobs.keys().next().value as string | undefined;
    if (!oldest) return;
    jobs.delete(oldest);
    onEvict();
  }
}

function pushBounded(values: number[], value: number): void {
  values.push(Math.max(0, value));
  if (values.length > 2_000) values.shift();
}

function toMetric(metric: MutableMetric): QueueTelemetryMetric {
  return {
    profile: metric.profile,
    queue: metric.queue,
    queued: metric.queued,
    completed: metric.completed,
    retrying: metric.retrying,
    deadLettered: metric.deadLettered,
    throttled: metric.throttled,
    inFlight: metric.inFlight,
    p95QueueWaitMs: percentile(metric.queueWaits, 0.95),
    p95ProcessingMs: percentile(metric.processingTimes, 0.95),
  };
}

function alertsFor(
  metric: QueueTelemetryMetric,
  policy: QueueTelemetryPolicy,
): QueueTelemetryAlert[] {
  const alerts: QueueTelemetryAlert[] = [];
  const retryRate =
    metric.retrying / Math.max(1, metric.completed + metric.retrying);
  const checks = [
    ["QUEUE_WAIT_SLO_EXCEEDED", metric.p95QueueWaitMs, policy.queueWaitSloMs],
    ["PROCESSING_SLO_EXCEEDED", metric.p95ProcessingMs, policy.processingSloMs],
    ["RETRY_RATE_EXCEEDED", retryRate, policy.retryRate],
    ["DEAD_LETTERS_PRESENT", metric.deadLettered, policy.deadLetters],
    ["IN_FLIGHT_LIMIT_EXCEEDED", metric.inFlight, policy.inFlight],
  ] as const;
  for (const [code, observed, threshold] of checks) {
    if (observed > threshold)
      alerts.push({
        code,
        profile: metric.profile,
        queue: metric.queue,
        observed,
        threshold,
      });
  }
  return alerts;
}

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * fraction) - 1] ?? 0;
}

function validatePolicy(policy: QueueTelemetryPolicy): void {
  for (const [name, value] of Object.entries(policy)) {
    if (!Number.isFinite(value) || value < 0)
      throw new Error(`Queue telemetry policy ${name} must be non-negative`);
  }
  if (policy.retryRate > 1)
    throw new Error("Queue telemetry retryRate must be at most one");
}
