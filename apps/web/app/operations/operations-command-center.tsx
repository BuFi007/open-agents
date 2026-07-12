"use client";

import {
  Activity,
  Bot,
  Check,
  CircleStop,
  Database,
  GitBranch,
  Play,
  RefreshCw,
  ShieldCheck,
  TerminalSquare,
  X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { useSessionChats } from "@/hooks/use-session-chats";
import { useSessions } from "@/hooks/use-sessions";
import { QueueTelemetryPanel } from "./queue-telemetry-panel";
import type { OperatingPackHarnessId } from "@/lib/operating-packs/runtime";

type Pack = {
  id: string;
  name: string;
  workflows: Array<{
    id: string;
    title: string;
    risk: string;
    requiredApproval: boolean;
    agentIds: string[];
    executionMode: "harness_agents" | "structured_external_state";
  }>;
};

type RunSummary = {
  id: string;
  workflowRunId: string | null;
  workspaceId: string;
  packId: string;
  workflowId: string;
  harnessId: string;
  status: string;
  approvalId: string | null;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
};

type RunDetail = RunSummary & {
  durableStatus: string | null;
  approval: { id: string; actions: string[] } | null;
  result: unknown;
};

type Trace = {
  id: string;
  sequence: number;
  type: string;
  agentId: string | null;
  summary: string | null;
  data: Record<string, unknown> | null;
  createdAt: string;
};

const TERMINAL = new Set(["completed", "failed", "cancelled", "rejected"]);

async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as T & {
    error?: string;
  };
  if (!response.ok)
    throw new Error(body.error ?? `Request failed (${response.status})`);
  return body;
}

function statusTone(status: string): string {
  if (status === "completed" || status === "approved")
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  if (status === "failed" || status === "rejected")
    return "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300";
  if (status === "awaiting_approval")
    return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  return "border-cyan-500/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300";
}

function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={`rounded-full border px-2 py-0.5 font-mono text-[11px] ${statusTone(status)}`}
    >
      {status.replaceAll("_", " ")}
    </span>
  );
}

export function OperationsCommandCenter() {
  const { sessions } = useSessions({ includeArchived: false });
  const [sessionId, setSessionId] = useState<string | null>(null);
  const { chats } = useSessionChats(sessionId);
  const [catalog, setCatalog] = useState<Pack[]>([]);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [traces, setTraces] = useState<Trace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [workspaceGrant, setWorkspaceGrant] = useState("");
  const [packId, setPackId] = useState("");
  const [workflowId, setWorkflowId] = useState("");
  const [harnessId, setHarnessId] =
    useState<OperatingPackHarnessId>("claude-code");
  const [prompt, setPrompt] = useState(
    "Review this workspace and produce evidence-backed operating findings.",
  );
  const [reason, setReason] = useState(
    "Evidence reviewed in the command center.",
  );
  const [busy, setBusy] = useState(false);

  const selectedPack = catalog.find((pack) => pack.id === packId);
  const selectedWorkflow = selectedPack?.workflows.find(
    (workflow) => workflow.id === workflowId,
  );
  const activeChatId = chats[0]?.id ?? null;

  const refreshCatalog = useCallback(async () => {
    const body = await readJson<{ packs: Pack[]; runs: RunSummary[] }>(
      await fetch("/api/operating-packs/runs?limit=50", { cache: "no-store" }),
    );
    const packs = body.packs
      .map((pack) => ({
        ...pack,
        workflows: pack.workflows.filter(
          (workflow) => workflow.executionMode === "harness_agents",
        ),
      }))
      .filter((pack) => pack.workflows.length > 0);
    setCatalog(packs);
    setRuns(body.runs);
    setPackId((current) => current || packs[0]?.id || "");
    setSelectedRunId((current) => current || body.runs[0]?.id || null);
  }, []);

  const refreshRun = useCallback(async (runId: string) => {
    const [nextDetail, traceBody] = await Promise.all([
      readJson<RunDetail>(
        await fetch(`/api/operating-packs/runs/${encodeURIComponent(runId)}`, {
          cache: "no-store",
        }),
      ),
      readJson<{ traces: Trace[] }>(
        await fetch(
          `/api/operating-packs/runs/${encodeURIComponent(runId)}/traces?limit=200`,
          { cache: "no-store" },
        ),
      ),
    ]);
    setDetail(nextDetail);
    setTraces(traceBody.traces);
  }, []);

  useEffect(() => {
    void refreshCatalog().catch((error: unknown) =>
      toast.error(
        error instanceof Error ? error.message : "Unable to load operations",
      ),
    );
  }, [refreshCatalog]);

  useEffect(() => {
    if (!sessionId && sessions[0]) setSessionId(sessions[0].id);
  }, [sessionId, sessions]);

  useEffect(() => {
    const workflows = selectedPack?.workflows ?? [];
    if (!workflows.some((workflow) => workflow.id === workflowId))
      setWorkflowId(workflows[0]?.id ?? "");
  }, [selectedPack, workflowId]);

  useEffect(() => {
    if (!selectedRunId) {
      setDetail(null);
      setTraces([]);
      return;
    }
    void refreshRun(selectedRunId).catch((error: unknown) =>
      toast.error(
        error instanceof Error ? error.message : "Unable to load run",
      ),
    );
    const timer = setInterval(
      () => {
        void refreshRun(selectedRunId).catch(() => undefined);
      },
      TERMINAL.has(detail?.status ?? "") ? 10_000 : 2_000,
    );
    return () => clearInterval(timer);
  }, [detail?.status, refreshRun, selectedRunId]);

  const agents = useMemo(() => {
    const known = new Map<
      string,
      { id: string; last: Trace; events: number }
    >();
    for (const trace of traces) {
      if (!trace.agentId) continue;
      const current = known.get(trace.agentId);
      known.set(trace.agentId, {
        id: trace.agentId,
        last: trace,
        events: (current?.events ?? 0) + 1,
      });
    }
    return [...known.values()];
  }, [traces]);

  const launch = async () => {
    if (!(sessionId && activeChatId && selectedWorkflow)) {
      toast.error("Select a session with an active chat and workflow");
      return;
    }
    setBusy(true);
    try {
      const response = await readJson<{ executionId: string }>(
        await fetch("/api/operating-packs/runs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sessionId,
            chatId: activeChatId,
            packId,
            workflowId: selectedWorkflow.id,
            harnessId,
            prompt,
            workspaceId,
            workspaceGrant,
            idempotencyKey: `command-center:${crypto.randomUUID()}`,
          }),
        }),
      );
      setWorkspaceGrant("");
      setSelectedRunId(response.executionId);
      await refreshCatalog();
      toast.success("Durable agent operation launched");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Launch failed");
    } finally {
      setBusy(false);
    }
  };

  const decide = async (decision: "approved" | "rejected") => {
    if (!selectedRunId) return;
    setBusy(true);
    try {
      await readJson(
        await fetch(`/api/operating-packs/runs/${selectedRunId}/approval`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ decision, reason }),
        }),
      );
      await refreshRun(selectedRunId);
      toast.success(
        decision === "approved" ? "Operation approved" : "Operation rejected",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Decision failed");
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!selectedRunId) return;
    setBusy(true);
    try {
      await readJson(
        await fetch(`/api/operating-packs/runs/${selectedRunId}/cancel`, {
          method: "POST",
        }),
      );
      await refreshRun(selectedRunId);
      toast.success("Operation cancelled");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Cancel failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,hsl(var(--muted)),transparent_45%)] p-4 md:p-8">
      <div className="mx-auto max-w-[1600px] space-y-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.25em] text-muted-foreground">
              BUFI / Agentic Workspaces
            </p>
            <h1 className="text-2xl font-semibold tracking-tight">
              Operations command center
            </h1>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => void refreshCatalog()}>
              <RefreshCw className="h-4 w-4" /> Refresh
            </Button>
            <Button variant="ghost" asChild>
              <Link href="/sessions">Back to sessions</Link>
            </Button>
          </div>
        </header>

        <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
          <Card className="h-fit">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Play className="h-4 w-4" /> Launch operation
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="workspace">Desk workspace UUID</Label>
                <Input
                  id="workspace"
                  value={workspaceId}
                  onChange={(event) => setWorkspaceId(event.target.value)}
                  placeholder="11111111-1111-4111-8111-111111111111"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="grant">One-time workspace grant</Label>
                <Input
                  id="grant"
                  type="password"
                  autoComplete="off"
                  value={workspaceGrant}
                  onChange={(event) => setWorkspaceGrant(event.target.value)}
                  placeholder="Signed by Desk; cleared after launch"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="session">Sandbox session</Label>
                <select
                  id="session"
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                  value={sessionId ?? ""}
                  onChange={(event) => setSessionId(event.target.value || null)}
                >
                  {sessions.map((session) => (
                    <option key={session.id} value={session.id}>
                      {session.title}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label htmlFor="pack">Operating pack</Label>
                  <select
                    id="pack"
                    className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                    value={packId}
                    onChange={(event) => setPackId(event.target.value)}
                  >
                    {catalog.map((pack) => (
                      <option key={pack.id} value={pack.id}>
                        {pack.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="harness">Harness</Label>
                  <select
                    id="harness"
                    className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                    value={harnessId}
                    onChange={(event) =>
                      setHarnessId(event.target.value as OperatingPackHarnessId)
                    }
                  >
                    <option value="codex">Codex</option>
                    <option value="claude-code">Claude Code</option>
                    <option value="pi">Pi</option>
                  </select>
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="workflow">Workflow</Label>
                <select
                  id="workflow"
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                  value={workflowId}
                  onChange={(event) => setWorkflowId(event.target.value)}
                >
                  {selectedPack?.workflows.map((workflow) => (
                    <option key={workflow.id} value={workflow.id}>
                      {workflow.title}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="prompt">Operating intent</Label>
                <Textarea
                  id="prompt"
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  rows={4}
                />
              </div>
              <Button
                className="w-full"
                disabled={
                  busy ||
                  !workspaceId ||
                  workspaceGrant.length < 80 ||
                  !activeChatId ||
                  !workflowId
                }
                onClick={() => void launch()}
              >
                <Play className="h-4 w-4" /> Launch durable team
              </Button>
              <p className="text-xs text-muted-foreground">
                Grant material stays in memory and is cleared after submission.
                Policy remains server-side.
              </p>
            </CardContent>
          </Card>

          <div className="min-w-0 space-y-4">
            <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Recent operations</CardTitle>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-64">
                    <div className="space-y-2">
                      {runs.map((run) => (
                        <button
                          type="button"
                          key={run.id}
                          onClick={() => setSelectedRunId(run.id)}
                          className={`w-full rounded-lg border p-3 text-left transition ${selectedRunId === run.id ? "border-foreground bg-muted" : "hover:bg-muted/60"}`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate font-mono text-xs">
                              {run.id}
                            </span>
                            <StatusPill status={run.status} />
                          </div>
                          <p className="mt-2 truncate text-sm">
                            {run.packId} / {run.workflowId}
                          </p>
                        </button>
                      ))}
                      {runs.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          No durable operations yet.
                        </p>
                      ) : null}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <GitBranch className="h-4 w-4" /> Workflow timeline
                    </CardTitle>
                    {detail ? <StatusPill status={detail.status} /> : null}
                  </div>
                </CardHeader>
                <CardContent>
                  {detail ? (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
                        <div>
                          <p className="text-xs text-muted-foreground">Pack</p>
                          <p className="font-mono">{detail.packId}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">
                            Workflow
                          </p>
                          <p className="font-mono">{detail.workflowId}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">
                            Harness
                          </p>
                          <p className="font-mono">{detail.harnessId}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">
                            Durable state
                          </p>
                          <p className="font-mono">
                            {detail.durableStatus ?? "pending"}
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-1 overflow-x-auto pb-2">
                        {traces.map((trace) => (
                          <div
                            key={trace.id}
                            title={trace.summary ?? trace.type}
                            className={`h-2 min-w-8 flex-1 rounded-full ${trace.type.includes("failed") ? "bg-red-500" : trace.type.includes("completed") ? "bg-emerald-500" : trace.type.includes("approval") ? "bg-amber-500" : "bg-cyan-500"}`}
                          />
                        ))}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={busy || TERMINAL.has(detail.status)}
                          onClick={() => void cancel()}
                        >
                          <CircleStop className="h-4 w-4" /> Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Select an operation to inspect it.
                    </p>
                  )}
                </CardContent>
              </Card>

              <QueueTelemetryPanel traces={traces} />
            </div>

            {detail?.approval ? (
              <Card className="border-amber-500/40">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <ShieldCheck className="h-4 w-4" /> Human approval required
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-3 md:flex-row">
                  <Input
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    aria-label="Approval reason"
                  />
                  <Button
                    disabled={busy || !reason.trim()}
                    onClick={() => void decide("approved")}
                  >
                    <Check className="h-4 w-4" /> Approve
                  </Button>
                  <Button
                    variant="destructive"
                    disabled={busy || !reason.trim()}
                    onClick={() => void decide("rejected")}
                  >
                    <X className="h-4 w-4" /> Reject
                  </Button>
                </CardContent>
              </Card>
            ) : null}

            <div className="grid gap-4 lg:grid-cols-3">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Bot className="h-4 w-4" /> Specialist roster
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {agents.map((agent) => (
                    <div key={agent.id} className="rounded-lg border p-3">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs">{agent.id}</span>
                        <span className="text-xs text-muted-foreground">
                          {agent.events} events
                        </span>
                      </div>
                      <p className="mt-2 line-clamp-2 text-sm">
                        {agent.last.summary ?? agent.last.type}
                      </p>
                    </div>
                  ))}
                  {agents.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Agents appear when execution begins.
                    </p>
                  ) : null}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Database className="h-4 w-4" /> Evidence context
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {traces
                    .filter(
                      (trace) => typeof trace.data?.packetHash === "string",
                    )
                    .map((trace) => (
                      <div key={trace.id} className="rounded-lg border p-3">
                        <p className="text-xs text-muted-foreground">
                          ContextPacket
                        </p>
                        <p className="truncate font-mono text-xs">
                          {String(trace.data?.packetHash)}
                        </p>
                      </div>
                    ))}
                  <p className="text-xs text-muted-foreground">
                    Packet hashes link agent claims to immutable workspace
                    evidence without exposing chain-of-thought.
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Activity className="h-4 w-4" /> Harness state
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Harness</span>
                    <span className="font-mono">
                      {detail?.harnessId ?? "—"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Workflow run</span>
                    <span className="max-w-40 truncate font-mono text-xs">
                      {detail?.workflowRunId ?? "—"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Traces</span>
                    <span>{traces.length}</span>
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card className="overflow-hidden bg-zinc-950 text-zinc-100">
              <CardHeader className="border-b border-zinc-800">
                <CardTitle className="flex items-center gap-2 font-mono text-sm">
                  <TerminalSquare className="h-4 w-4 text-cyan-400" /> bufi
                  operations console
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="h-80">
                  <div className="space-y-1 p-4 font-mono text-xs">
                    {traces.map((trace) => (
                      <div
                        key={trace.id}
                        className="grid grid-cols-[54px_120px_minmax(0,1fr)] gap-3"
                      >
                        <span className="text-zinc-600">#{trace.sequence}</span>
                        <span className="truncate text-cyan-400">
                          {trace.type}
                        </span>
                        <span className="text-zinc-300">
                          {trace.summary ?? "—"}
                        </span>
                      </div>
                    ))}
                    {traces.length === 0 ? (
                      <p className="text-zinc-500">
                        Waiting for operation traces…
                      </p>
                    ) : null}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </main>
  );
}
