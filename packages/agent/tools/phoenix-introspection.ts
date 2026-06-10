/**
 * Phoenix introspection tools — the agent reads its own operational
 * history before planning and after failures.
 *
 * Two native tools backed by the Phoenix REST API (via
 * `@open-agents/arize-phoenix`), production-safe on serverless:
 *
 *   - `recall_similar_runs` — top-N recent traces (optionally failures
 *     only) lexically matched to the current mission. Use before
 *     planning to avoid repeating past mistakes.
 *
 *   - `find_resolved_gap` — looks up the curated `bufi-resolved-gaps`
 *     dataset for a known fix matching a failure hypothesis. On hit
 *     the agent applies `fixSummary` + `mustMention` and retries
 *     instead of escalating.
 *
 * Both fail soft ({ available: false }) — introspection never blocks
 * a run.
 */

import { findResolvedGap, recallSimilarRuns } from "@open-agents/arize-phoenix";
import { tool } from "ai";
import { z } from "zod";

const recallInputSchema = z.object({
  query: z
    .string()
    .min(3)
    .describe(
      "The current mission/intent, in a few words. Used to match against past run inputs.",
    ),
  failuresOnly: z
    .boolean()
    .optional()
    .describe("Only return runs that errored. Use when diagnosing a failure."),
  repo: z
    .string()
    .optional()
    .describe("Restrict to a repo slug (owner/name) when known."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .describe("Top-N runs to return. Default 3."),
});

export const recallSimilarRunsTool = tool({
  description: `Recall this agent's own recent runs from Arize Phoenix traces.

USAGE:
- Call BEFORE planning a mission to learn from similar past runs (what worked, what failed)
- Call with failuresOnly: true when something just failed — the most recent errored trace usually explains why
- Results include a summary of the original input, the outcome (completed/errored), latency, and the Phoenix traceId

This reads the agent's real production telemetry — treat the results as ground truth about past behavior.`,
  inputSchema: recallInputSchema,
  execute: async ({ query, failuresOnly, repo, limit }) => {
    return await recallSimilarRuns({
      query,
      ...(failuresOnly !== undefined ? { failuresOnly } : {}),
      ...(repo ? { repo } : {}),
      ...(limit ? { limit } : {}),
    });
  },
});

const findResolvedGapInputSchema = z.object({
  hypothesis: z
    .string()
    .min(10)
    .describe(
      "Your diagnosis of what went wrong, mentioning the distinctive identifiers involved (tool name, env var, field name).",
    ),
  toolName: z
    .string()
    .optional()
    .describe("The tool you were trying to use when it failed."),
  kind: z
    .string()
    .optional()
    .describe(
      'Failure category, e.g. "missing-env", "wrong-field", "dead-instruction".',
    ),
});

export const findResolvedGapTool = tool({
  description: `Look up the curated bufi-resolved-gaps dataset in Arize Phoenix for a KNOWN FIX matching a failure you just hit.

USAGE:
- Call AFTER a tool call or approach fails and you have a hypothesis about why
- On a hit: apply the returned fixSummary, incorporate the mustMention tokens in your retry, and continue — do NOT escalate to the user for a problem that already has a curated fix
- On a miss: proceed with your own debugging and clearly report the gap in your final summary so a human can curate it`,
  inputSchema: findResolvedGapInputSchema,
  execute: async ({ hypothesis, toolName, kind }) => {
    return await findResolvedGap({
      hypothesis,
      ...(toolName ? { toolName } : {}),
      ...(kind ? { kind } : {}),
    });
  },
});
