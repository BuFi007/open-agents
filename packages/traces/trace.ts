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
    | "approval.approved"
    | "approval.rejected"
    | "agent.completed"
    | "run.blocked"
    | "run.retried"
    | "run.completed"
    | "run.failed"
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
const SECRET_VALUE_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /\b(?:sk|pk|rk|api)[-_](?:live|test|prod)?[_-]?[A-Za-z0-9]{16,}\b/gi,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
] as const;

export function sanitizeTraceText(value: string): string {
  let sanitized = value;
  for (const pattern of SECRET_VALUE_PATTERNS)
    sanitized = sanitized.replace(pattern, "[redacted]");
  return sanitized.length > 2000 ? `${sanitized.slice(0, 2000)}…` : sanitized;
}

const redact = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !SECRET.test(key))
        .map(([key, entry]) => [key, redact(entry)]),
    );
  if (typeof value === "string") return sanitizeTraceText(value);
  return value;
};

export function redactTraceData(
  data: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, unknown>> | undefined {
  return data ? (redact(data) as Readonly<Record<string, unknown>>) : undefined;
}

export function createTrace(
  input: Omit<TraceEvent, "id" | "data" | "summary"> & {
    data?: Readonly<Record<string, unknown>>;
    summary?: string;
  },
): TraceEvent {
  const data = redactTraceData(input.data);
  const summary = input.summary ? sanitizeTraceText(input.summary) : undefined;
  const nonce = globalThis.crypto.randomUUID().replaceAll("-", "").slice(0, 16);
  const event: TraceEvent = {
    ...input,
    id: `${input.runId}:${input.type}:${input.at}:${nonce}`,
    summary,
    data,
  };
  return event;
}

export async function persistTrace(
  input: Parameters<typeof createTrace>[0],
  sink: TraceSink,
): Promise<TraceEvent> {
  const event = createTrace(input);
  await sink.append(event);
  return event;
}
