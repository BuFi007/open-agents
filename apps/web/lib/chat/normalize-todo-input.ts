import type { TodoItem, TodoStatus } from "@open-agents/agent";

const TODO_STATUSES = new Set<TodoStatus>([
  "pending",
  "in_progress",
  "completed",
]);

/**
 * Harness tool inputs arrive over the bridge as untyped JSON and can be
 * malformed (stringified values, a single todo object, or incomplete items).
 * Coerce whatever arrived into renderable todos and drop unusable entries.
 */
export function normalizeTodoInput(input: unknown): TodoItem[] {
  const root = parseMaybeJson(input);
  const rawTodos = Array.isArray(root)
    ? root
    : isRecord(root)
      ? parseMaybeJson(root.todos)
      : [];
  const list = Array.isArray(rawTodos)
    ? rawTodos
    : isRecord(rawTodos)
      ? [rawTodos]
      : [];

  return list
    .map(normalizeTodo)
    .filter((todo): todo is TodoItem => todo !== null);
}

function normalizeTodo(value: unknown, index: number): TodoItem | null {
  const parsed = parseMaybeJson(value);

  if (typeof parsed === "string") {
    const content = parsed.trim();
    return content ? { id: `todo-${index}`, content, status: "pending" } : null;
  }

  if (!isRecord(parsed) || typeof parsed.content !== "string") {
    return null;
  }

  const content = parsed.content.trim();
  if (!content) {
    return null;
  }

  return {
    id:
      typeof parsed.id === "string" && parsed.id.trim()
        ? parsed.id.trim()
        : `todo-${index}`,
    content,
    status: isTodoStatus(parsed.status) ? parsed.status : "pending",
  };
}

function isTodoStatus(value: unknown): value is TodoStatus {
  return typeof value === "string" && TODO_STATUSES.has(value as TodoStatus);
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) {
    return value;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
