export type TraceEvent = {
  id: string;
  workspaceId: string;
  runId: string;
  type:
    | "workflow.started"
    | "agent.started"
    | "kg.read"
    | "tool.called"
    | "artifact.emitted"
    | "approval.requested"
    | "run.blocked"
    | "run.retried"
    | "run.completed"
    | "run.cancelled";
  agentId?: string;
  toolName?: string;
  summary?: string;
  data?: Readonly<Record<string, unknown>>;
  at: number;
};

export type TraceSink = { append(event: TraceEvent): Promise<void> };

const SECRET =
  /(token|secret|password|credential|authorization|api[-_]?key|private[-_]?key|chain[-_]?of[-_]?thought|reasoning)/i;
const redact = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !SECRET.test(key))
        .map(([key, entry]) => [key, redact(entry)]),
    );
  if (typeof value === "string" && value.length > 2000)
    return `${value.slice(0, 2000)}…`;
  return value;
};

export function redactTraceData(
  data: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, unknown>> | undefined {
  return data ? (redact(data) as Readonly<Record<string, unknown>>) : undefined;
}

export function createTrace(
  input: Omit<TraceEvent, "id" | "data"> & {
    data?: Readonly<Record<string, unknown>>;
  },
  sink?: TraceSink,
): TraceEvent {
  const event: TraceEvent = {
    ...input,
    id: `${input.runId}:${input.type}:${input.at}`,
    data: redactTraceData(input.data),
  };
  if (sink) void sink.append(event);
  return event;
}
