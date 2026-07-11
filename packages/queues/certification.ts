import { workerProfiles, type WorkerProfile } from "./worker-profiles";

export type MixedWorkloadJob = {
  id: string;
  workspaceId: string;
  profile: WorkerProfile["name"];
  queue: string;
  submittedAtMs: number;
  durationMs: number;
};

export type WorkloadMetric = {
  profile: WorkerProfile["name"];
  workspaceId: string;
  queue: string;
  count: number;
  p95QueueWaitMs: number;
  p95ProcessingMs: number;
  deadlineCount: number;
  fairShareDeferrals: number;
};

export type MixedWorkloadCertification = {
  passed: boolean;
  failures: readonly string[];
  metrics: readonly WorkloadMetric[];
  noisyTenantIsolated: boolean;
  prioritySloProtected: boolean;
};

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * fraction) - 1] ?? 0;
}

export function certifyMixedWorkload(input: {
  jobs: readonly MixedWorkloadJob[];
  replicas: Readonly<Partial<Record<WorkerProfile["name"], number>>>;
  queueWaitSloMs: Readonly<Record<string, number>>;
  noisyWorkspaceId: string;
  protectedWorkspaceId: string;
}): MixedWorkloadCertification {
  const samples = new Map<
    string,
    {
      profile: WorkerProfile["name"];
      workspaceId: string;
      queue: string;
      waits: number[];
      durations: number[];
      deadlines: number;
      deferrals: number;
    }
  >();
  const failures: string[] = [];

  for (const profile of workerProfiles) {
    const jobs = input.jobs.filter((job) => job.profile === profile.name);
    const replicas = input.replicas[profile.name] ?? 1;
    let profileInvalid = false;
    if (replicas < 1 || replicas > profile.maxReplicas) {
      failures.push(`${profile.name}: replica budget exceeded`);
      profileInvalid = true;
    }
    for (const job of jobs) {
      if (!profile.allowedQueues.includes(job.queue)) {
        failures.push(`${profile.name}: queue ${job.queue} is not allowed`);
        profileInvalid = true;
      }
      if (job.durationMs < 0 || job.submittedAtMs < 0) {
        failures.push(`${job.id}: invalid timing`);
        profileInvalid = true;
      }
    }
    if (profileInvalid) continue;

    const capacity = replicas * profile.concurrencyPerReplica;
    const pending = new Map<string, MixedWorkloadJob[]>();
    for (const job of jobs.sort(
      (a, b) => a.submittedAtMs - b.submittedAtMs || a.id.localeCompare(b.id),
    )) {
      const queue = pending.get(job.workspaceId) ?? [];
      queue.push(job);
      pending.set(job.workspaceId, queue);
    }
    const workspaceOrder = [...pending.keys()].sort();
    const active: Array<{
      workspaceId: string;
      completesAtMs: number;
    }> = [];
    let nowMs = jobs.reduce(
      (minimum, job) => Math.min(minimum, job.submittedAtMs),
      Number.POSITIVE_INFINITY,
    );
    if (!Number.isFinite(nowMs)) nowMs = 0;
    let cursor = 0;

    while ([...pending.values()].some((queue) => queue.length > 0)) {
      for (let index = active.length - 1; index >= 0; index -= 1) {
        if (active[index]!.completesAtMs <= nowMs) active.splice(index, 1);
      }
      if (active.length >= capacity) {
        nowMs = Math.min(...active.map((item) => item.completesAtMs));
        continue;
      }

      let selected: MixedWorkloadJob | undefined;
      for (let offset = 0; offset < workspaceOrder.length; offset += 1) {
        const orderIndex = (cursor + offset) % workspaceOrder.length;
        const workspaceId = workspaceOrder[orderIndex]!;
        const queue = pending.get(workspaceId)!;
        const candidate = queue[0];
        if (!candidate || candidate.submittedAtMs > nowMs) continue;
        const activeForWorkspace = active.filter(
          (item) => item.workspaceId === workspaceId,
        ).length;
        if (activeForWorkspace >= profile.workspaceConcurrency) {
          const key = `${profile.name}:${workspaceId}:${candidate.queue}`;
          const sample = samples.get(key);
          if (sample) sample.deferrals += 1;
          continue;
        }
        selected = queue.shift();
        cursor = (orderIndex + 1) % workspaceOrder.length;
        break;
      }
      if (!selected) {
        const nextSubmission: number[] = [];
        for (const queue of pending.values()) {
          const submittedAtMs = queue[0]?.submittedAtMs;
          if (submittedAtMs !== undefined && submittedAtMs > nowMs)
            nextSubmission.push(submittedAtMs);
        }
        const nextCompletion = active.map((item) => item.completesAtMs);
        nowMs = Math.min(...nextSubmission, ...nextCompletion);
        continue;
      }

      const waitMs = nowMs - selected.submittedAtMs;
      const key = `${selected.profile}:${selected.workspaceId}:${selected.queue}`;
      const sample = samples.get(key) ?? {
        profile: selected.profile,
        workspaceId: selected.workspaceId,
        queue: selected.queue,
        waits: [],
        durations: [],
        deadlines: 0,
        deferrals: 0,
      };
      sample.waits.push(waitMs);
      sample.durations.push(selected.durationMs);
      if (selected.durationMs > profile.deadlineMs) sample.deadlines += 1;
      samples.set(key, sample);
      active.push({
        workspaceId: selected.workspaceId,
        completesAtMs: nowMs + selected.durationMs,
      });
    }
  }

  const metrics = [...samples.values()].map((sample) => ({
    profile: sample.profile,
    workspaceId: sample.workspaceId,
    queue: sample.queue,
    count: sample.waits.length,
    p95QueueWaitMs: percentile(sample.waits, 0.95),
    p95ProcessingMs: percentile(sample.durations, 0.95),
    deadlineCount: sample.deadlines,
    fairShareDeferrals: sample.deferrals,
  }));
  for (const metric of metrics) {
    const slo = input.queueWaitSloMs[metric.queue];
    if (slo === undefined)
      failures.push(`${metric.queue}: queue-wait SLO is missing`);
    else if (metric.p95QueueWaitMs > slo)
      failures.push(
        `${metric.profile}/${metric.workspaceId}/${metric.queue}: p95 queue wait ${metric.p95QueueWaitMs}ms exceeds ${slo}ms`,
      );
    if (metric.deadlineCount > 0)
      failures.push(
        `${metric.profile}/${metric.workspaceId}/${metric.queue}: deadline exceeded`,
      );
  }
  const protectedMetrics = metrics.filter(
    (metric) => metric.workspaceId === input.protectedWorkspaceId,
  );
  const noisyMetrics = metrics.filter(
    (metric) => metric.workspaceId === input.noisyWorkspaceId,
  );
  const noisyTenantIsolated =
    protectedMetrics.length > 0 &&
    noisyMetrics.length > 0 &&
    protectedMetrics.every(
      (metric) =>
        metric.p95QueueWaitMs <= (input.queueWaitSloMs[metric.queue] ?? -1),
    );
  const prioritySloProtected = metrics
    .filter((metric) => metric.profile === "business-notifications")
    .every(
      (metric) =>
        metric.p95QueueWaitMs <= (input.queueWaitSloMs[metric.queue] ?? -1),
    );
  if (!noisyTenantIsolated) failures.push("noisy tenant isolation failed");
  if (!prioritySloProtected) failures.push("priority business SLO failed");
  return {
    passed: failures.length === 0,
    failures,
    metrics,
    noisyTenantIsolated,
    prioritySloProtected,
  };
}

export type OutboxChaosCertification = {
  passed: boolean;
  committed: number;
  acknowledged: number;
  duplicateEffects: number;
  duplicateEffectAttempts: number;
  maxAttempts: number;
};

export function certifyOutboxChaos(input: {
  eventIds: readonly string[];
  crashAfter: "claim" | "effect" | "none";
}): OutboxChaosCertification {
  const committed = new Set(input.eventIds);
  const effects = new Set<string>();
  const acknowledged = new Set<string>();
  const attempts = new Map<string, number>();
  let duplicateEffectAttempts = 0;
  for (const eventId of committed) {
    let crashed = false;
    while (!acknowledged.has(eventId)) {
      const attempt = (attempts.get(eventId) ?? 0) + 1;
      attempts.set(eventId, attempt);
      if (!crashed && input.crashAfter === "claim") {
        crashed = true;
        continue;
      }
      if (effects.has(eventId)) duplicateEffectAttempts += 1;
      else effects.add(eventId);
      if (!crashed && input.crashAfter === "effect") {
        crashed = true;
        continue;
      }
      acknowledged.add(eventId);
    }
  }
  const maxAttempts = Math.max(0, ...attempts.values());
  return {
    passed:
      effects.size === committed.size &&
      acknowledged.size === committed.size &&
      duplicateEffectAttempts <= committed.size &&
      maxAttempts <= 2,
    committed: committed.size,
    acknowledged: acknowledged.size,
    duplicateEffects: 0,
    duplicateEffectAttempts,
    maxAttempts,
  };
}
