import type { AskUserQuestionInput } from "@open-agents/agent";

type Question = AskUserQuestionInput["questions"][number];
type QuestionOption = Question["options"][number];

/**
 * Harness tool inputs arrive over the bridge as untyped JSON and can be
 * malformed (stringified nested values, missing fields, non-array questions).
 * Coerce whatever arrived into renderable questions instead of trusting the
 * declared schema; anything unsalvageable is dropped.
 */
export function normalizeAskUserQuestionInput(
  input: unknown,
): AskUserQuestionInput["questions"] {
  const root = parseMaybeJson(input);
  if (!isRecord(root)) {
    return [];
  }

  const rawQuestions = parseMaybeJson(root.questions);
  const list = Array.isArray(rawQuestions)
    ? rawQuestions
    : isRecord(rawQuestions)
      ? [rawQuestions]
      : [];

  return list
    .map(normalizeQuestion)
    .filter((question): question is Question => question !== null);
}

function normalizeQuestion(value: unknown): Question | null {
  const record = parseMaybeJson(value);
  if (!isRecord(record) || typeof record.question !== "string") {
    return null;
  }
  const question = record.question.trim();
  if (!question) {
    return null;
  }

  const rawOptions = parseMaybeJson(record.options);
  const options = (Array.isArray(rawOptions) ? rawOptions : [])
    .map(normalizeOption)
    .filter((option): option is QuestionOption => option !== null);

  return {
    question,
    header:
      typeof record.header === "string" && record.header.trim()
        ? record.header.trim().slice(0, 12)
        : question.slice(0, 12),
    options,
    multiSelect: record.multiSelect === true,
  };
}

function normalizeOption(value: unknown): QuestionOption | null {
  const record = parseMaybeJson(value);
  if (isRecord(record) && typeof record.label === "string" && record.label) {
    return {
      label: record.label,
      description:
        typeof record.description === "string" ? record.description : "",
    };
  }
  if (typeof value === "string" && value.trim()) {
    return { label: value.trim(), description: "" };
  }
  return null;
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
