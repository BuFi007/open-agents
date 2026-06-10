/**
 * LLM-as-a-Judge evals over Phoenix traces.
 *
 * Pulls recent root spans from the Phoenix project, scores each mission
 * with a Gemini judge (tool-use correctness + task completion), posts
 * the verdicts back to Phoenix as span annotations (visible in the
 * Phoenix UI), and writes evalScore/evalLabel onto the matching Open
 * Agents session rows (rendered as badges in the sessions list).
 *
 * Run from apps/open-agents (needs PHOENIX_* + AI_GATEWAY_API_KEY +
 * POSTGRES_URL):
 *   bun --env-file=apps/web/.env.local --env-file=../../.env.local scripts/phoenix-eval.ts
 */

import { generateText } from "ai";
import { phoenixFetch } from "../packages/arize-phoenix/_fetch";
import {
  getPhoenixApiKey,
  getPhoenixCollectorEndpoint,
  getPhoenixProjectName,
  isPhoenixEnabled,
} from "../packages/arize-phoenix/client";
import { gateway } from "../packages/agent/models";

const JUDGE_MODEL = "google/gemini-3-flash";
const ANNOTATION_NAME = "bufi-mission-quality";
const SPAN_FETCH_LIMIT = 100;

interface PhoenixSpan {
  name?: string;
  parent_id?: string | null;
  status_code?: string;
  start_time?: string;
  context?: { trace_id?: string; span_id?: string };
  attributes?: Record<string, unknown>;
}

interface Verdict {
  score: number;
  label: "pass" | "partial" | "fail";
  explanation: string;
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

async function fetchRecentRootSpans(): Promise<PhoenixSpan[]> {
  const collector = getPhoenixCollectorEndpoint().replace(/\/$/, "");
  const apiKey = getPhoenixApiKey();
  const project = getPhoenixProjectName();
  const url = new URL(
    `${collector}/v1/projects/${encodeURIComponent(project)}/spans`,
  );
  url.searchParams.set("limit", String(SPAN_FETCH_LIMIT));

  const res = await phoenixFetch(url.toString(), {
    headers: {
      accept: "application/json",
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    },
    timeoutMs: 10_000,
  });
  if (!res.ok) {
    throw new Error(`Phoenix spans fetch failed: ${res.status}`);
  }
  const data = (await res.json()) as { data?: PhoenixSpan[] } | null;
  const spans = Array.isArray(data?.data) ? data.data : [];
  return spans.filter((span) => !span.parent_id);
}

async function judgeSpan(span: PhoenixSpan): Promise<Verdict | null> {
  const attrs = span.attributes ?? {};
  const input = readString(attrs["input.value"]) ?? "";
  const output = readString(attrs["output.value"]) ?? "";
  if (!input && !output) {
    return null;
  }

  const { text } = await generateText({
    model: gateway(JUDGE_MODEL),
    prompt: `You are an exacting QA judge for an autonomous coding/ops agent.
Evaluate this agent run on two dimensions:
1. Tool-use correctness — did the agent's actions (visible in the output) follow logically from the mission? Any signs of flailing, hallucinated results, or wrong targets?
2. Task completion — does the output indicate the mission was actually finished (not just attempted)?

Mission input (truncated):
${input.slice(0, 2000)}

Final output / status (truncated):
${output.slice(0, 2000)}

Run status code: ${span.status_code ?? "UNSET"}

Respond with ONLY a JSON object, no markdown fences:
{"score": <0..1>, "label": "pass"|"partial"|"fail", "explanation": "<one sentence>"}`,
    // Gemini 3 thinking burns output budget as reasoning tokens before
    // any text — keep generous headroom or text comes back empty.
    maxOutputTokens: 2000,
  });

  try {
    const cleaned = text.trim().replace(/^```(?:json)?|```$/g, "");
    const parsed = JSON.parse(cleaned) as Partial<Verdict>;
    if (
      typeof parsed.score !== "number" ||
      typeof parsed.label !== "string" ||
      !["pass", "partial", "fail"].includes(parsed.label)
    ) {
      return null;
    }
    return {
      score: Math.max(0, Math.min(1, parsed.score)),
      label: parsed.label as Verdict["label"],
      explanation:
        typeof parsed.explanation === "string" ? parsed.explanation : "",
    };
  } catch {
    console.warn(
      "[eval] judge returned unparseable verdict:",
      text.slice(0, 120),
    );
    return null;
  }
}

async function annotateSpan(
  spanId: string,
  verdict: Verdict,
): Promise<boolean> {
  const collector = getPhoenixCollectorEndpoint().replace(/\/$/, "");
  const apiKey = getPhoenixApiKey();
  const res = await phoenixFetch(`${collector}/v1/span_annotations`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      data: [
        {
          span_id: spanId,
          name: ANNOTATION_NAME,
          annotator_kind: "LLM",
          result: {
            label: verdict.label,
            score: verdict.score,
            explanation: verdict.explanation,
          },
        },
      ],
    }),
    timeoutMs: 10_000,
  });
  return res.ok;
}

async function writeSessionScore(
  sessionId: string,
  verdict: Verdict,
): Promise<boolean> {
  if (!process.env.POSTGRES_URL) {
    return false;
  }
  // Resolved through apps/web so drizzle/postgres deps come from there.
  const { writeSessionEval } =
    await import("../apps/web/lib/db/eval-writeback");
  return writeSessionEval({
    sessionId,
    score: verdict.score,
    label: verdict.label,
  });
}

async function main() {
  if (!isPhoenixEnabled()) {
    console.error("PHOENIX_API_KEY not set — aborting");
    process.exit(1);
  }

  const rootSpans = await fetchRecentRootSpans();
  console.info(
    `[eval] ${rootSpans.length} root spans to judge (model: ${JUDGE_MODEL})`,
  );

  let annotated = 0;
  let sessionsUpdated = 0;

  for (const span of rootSpans) {
    const spanId = span.context?.span_id;
    if (!spanId) {
      continue;
    }

    const verdict = await judgeSpan(span);
    if (!verdict) {
      console.info(`[eval] skip ${span.name ?? spanId} (no judgeable content)`);
      continue;
    }

    const ok = await annotateSpan(spanId, verdict);
    if (ok) {
      annotated += 1;
    }

    const sessionId =
      readString(span.attributes?.["ai.telemetry.metadata.sessionId"]) ??
      readString(span.attributes?.["metadata.sessionId"]);
    let sessionNote = "";
    if (sessionId) {
      const wrote = await writeSessionScore(sessionId, verdict).catch(
        () => false,
      );
      if (wrote) {
        sessionsUpdated += 1;
        sessionNote = ` → session ${sessionId}`;
      }
    }

    console.info(
      `[eval] ${verdict.label.toUpperCase()} ${verdict.score.toFixed(2)} ${span.name ?? spanId}${sessionNote} — ${verdict.explanation}`,
    );
  }

  console.info(
    `[eval] done: ${annotated} annotations posted, ${sessionsUpdated} session rows scored`,
  );
  process.exit(0);
}

await main();
