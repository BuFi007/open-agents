import { createHash } from "node:crypto";
import postgres from "postgres";

type RunRow = {
  workspace_id: string;
  workflow_id: string;
  status: string;
  created_at: string;
  finished_at: string | null;
};

type TraceRow = {
  id: string;
  run_id: string;
  workspace_id: string;
  sequence: number;
  type: string;
  summary: string | null;
  data: unknown;
  created_at: string;
};

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const endMs = Date.now();
const startMs = endMs - 7 * 24 * 60 * 60 * 1_000;
const sql = postgres(databaseUrl, { max: 1, connect_timeout: 10 });

function hash(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, nested) => {
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      return Object.fromEntries(
        Object.entries(nested as Record<string, unknown>).sort(([a], [b]) =>
          a.localeCompare(b),
        ),
      );
    }
    return nested;
  });
}

function text(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}

function containsSpendTool(row: TraceRow): boolean {
  const body =
    `${row.type} ${row.summary ?? ""} ${text(row.data)}`.toLowerCase();
  return [
    "circle_pay_service",
    "circle_gateway_deposit",
    "circle_wallet_fund",
    "circle_deploy_wallet",
    "circle_fund_fiat",
  ].some((tool) => body.includes(tool));
}

try {
  const runs = await sql<RunRow[]>`
    SELECT workspace_id, workflow_id, status, created_at::text, finished_at::text
    FROM operating_pack_runs
    WHERE created_at >= to_timestamp(${startMs / 1000})
      AND created_at <= to_timestamp(${endMs / 1000})
    ORDER BY created_at, workflow_id
  `;
  const traces = await sql<TraceRow[]>`
    SELECT t.id, t.run_id, t.workspace_id, t.sequence, t.type,
           t.summary, t.data, t.created_at::text
    FROM operating_pack_traces t
    JOIN operating_pack_runs r ON r.id = t.run_id
    WHERE r.created_at >= to_timestamp(${startMs / 1000})
      AND r.created_at <= to_timestamp(${endMs / 1000})
    ORDER BY t.created_at, t.run_id, t.sequence
  `;

  const workflowIds = [...new Set(runs.map((run) => run.workflow_id))].sort();
  const completedRuns = runs.filter((run) => run.status === "completed");
  const toolCalls = traces.filter((trace) => trace.type === "tool.called");
  const approvals = traces.filter((trace) =>
    ["approval.requested", "approval.rejected", "approval.approved"].includes(
      trace.type,
    ),
  );
  const spendTraces = traces.filter(containsSpendTool);
  const executedSpend = traces.filter(
    (trace) =>
      [
        "tool.completed",
        "payment.completed",
        "wallet.mutation.completed",
      ].includes(trace.type) && containsSpendTool(trace),
  );

  const linkedTraceHashes = traces.map((trace) =>
    hash(
      canonical({
        runId: hash(trace.run_id),
        workspaceId: hash(trace.workspace_id),
        sequence: trace.sequence,
        type: trace.type,
        createdAt: trace.created_at,
      }),
    ),
  );
  const report = {
    schemaVersion: "bufi.operating-week.v1",
    window: {
      startMs,
      endMs,
      requiredCoverageMs: 7 * 24 * 60 * 60 * 1_000,
      observedCoverageMs:
        runs.length > 0
          ? Math.max(
              0,
              new Date(runs[runs.length - 1]!.created_at).getTime() -
                new Date(runs[0]!.created_at).getTime(),
            )
          : 0,
    },
    workspaceCount: new Set(runs.map((run) => hash(run.workspace_id))).size,
    workflows: workflowIds.map((workflowId) => hash(workflowId)),
    kpis: {
      workflowRuns: runs.length,
      completedRuns: completedRuns.length,
      toolCalls: toolCalls.length,
      approvalEvents: approvals.length,
      unexpectedSpend: executedSpend.length,
    },
    spend: {
      spendRelatedTraceCount: spendTraces.length,
      executedSpendCount: executedSpend.length,
      approvalGated: spendTraces.length === 0 || approvals.length > 0,
    },
    traceCount: traces.length,
    traceRoot: hash(linkedTraceHashes.join("\n")),
    evidence: linkedTraceHashes,
    criteria: {
      threeWorkflows: workflowIds.length >= 3,
      fiveKpis: true,
      linkedTraces: traces.length > 0,
      zeroUnexpectedSpend: executedSpend.length === 0,
      fullSevenDayCoverage:
        runs.length > 0 &&
        new Date(runs[runs.length - 1]!.created_at).getTime() -
          new Date(runs[0]!.created_at).getTime() >=
          7 * 24 * 60 * 60 * 1_000,
    },
  };
  const passed = Object.values(report.criteria).every(Boolean);
  const output = { ...report, passed, reportHash: hash(canonical(report)) };
  console.log(JSON.stringify(output, null, 2));
  process.exitCode = passed ? 0 : 1;
} finally {
  await sql.end({ timeout: 5 });
}
