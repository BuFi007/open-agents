import { Activity, AlertTriangle, CheckCircle2 } from "lucide-react";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const metricSchema = z
  .object({
    profile: z.string().min(1).max(80),
    queue: z.string().min(1).max(191),
    completed: z.number().int().nonnegative(),
    retrying: z.number().int().nonnegative(),
    deadLettered: z.number().int().nonnegative(),
    throttled: z.number().int().nonnegative(),
    inFlight: z.number().int().nonnegative(),
    p95QueueWaitMs: z.number().int().nonnegative(),
    p95ProcessingMs: z.number().int().nonnegative(),
  })
  .passthrough();
const alertSchema = z
  .object({
    code: z.string().min(1).max(80),
    profile: z.string().min(1).max(80),
    queue: z.string().min(1).max(191),
    observed: z.number().finite().nonnegative(),
    threshold: z.number().finite().nonnegative(),
  })
  .strict();
const snapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    generatedAtMs: z.number().int().positive().safe(),
    factCount: z.number().int().positive(),
    metrics: z.array(metricSchema).max(100),
    alerts: z.array(alertSchema).max(500),
  })
  .passthrough();

type TelemetryTrace = Readonly<{
  type: string;
  data: Readonly<Record<string, unknown>> | null;
}>;

export function QueueTelemetryPanel({
  traces,
}: {
  traces: readonly TelemetryTrace[];
}) {
  const snapshots = traces
    .filter((trace) => trace.type === "queue.telemetry")
    .map((trace) => snapshotSchema.safeParse(trace.data))
    .filter((result) => result.success)
    .map((result) => result.data)
    .sort((left, right) => right.generatedAtMs - left.generatedAtMs);
  const latest = snapshots[0];
  if (!latest) return null;

  return (
    <Card data-testid="queue-telemetry-panel">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Activity className="h-4 w-4" /> Queue plane
          </CardTitle>
          <span
            className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${latest.alerts.length > 0 ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"}`}
          >
            {latest.alerts.length > 0 ? (
              <AlertTriangle className="h-3 w-3" />
            ) : (
              <CheckCircle2 className="h-3 w-3" />
            )}
            {latest.alerts.length > 0
              ? `${latest.alerts.length} SLO alert${latest.alerts.length === 1 ? "" : "s"}`
              : "Within SLO"}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {latest.metrics.map((metric) => (
            <div
              key={`${metric.profile}:${metric.queue}`}
              className="rounded-lg border bg-muted/20 p-3"
            >
              <p className="truncate font-mono text-xs">
                {metric.profile}/{metric.queue}
              </p>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                <Metric label="wait p95" value={`${metric.p95QueueWaitMs}ms`} />
                <Metric
                  label="process p95"
                  value={`${metric.p95ProcessingMs}ms`}
                />
                <Metric label="retries" value={String(metric.retrying)} />
                <Metric
                  label="dead letters"
                  value={String(metric.deadLettered)}
                />
              </div>
            </div>
          ))}
        </div>
        {latest.alerts.length > 0 ? (
          <ul className="space-y-1 text-xs text-amber-700 dark:text-amber-300">
            {latest.alerts.slice(0, 8).map((alert) => (
              <li key={`${alert.profile}:${alert.queue}:${alert.code}`}>
                {alert.code} · {alert.profile}/{alert.queue} · {alert.observed}{" "}
                &gt; {alert.threshold}
              </li>
            ))}
          </ul>
        ) : null}
        <p className="text-xs text-muted-foreground">
          {latest.factCount} payload-free queue facts · generated{" "}
          {new Date(latest.generatedAtMs).toISOString()}
        </p>
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-muted-foreground">{label}</p>
      <p className="font-mono tabular-nums">{value}</p>
    </div>
  );
}
