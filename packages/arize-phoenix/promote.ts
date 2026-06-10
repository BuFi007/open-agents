/**
 * open-agents/arize-phoenix/promote — auto-curation primitives.
 *
 * Two compound functions powering the self-improvement loop without
 * human work per run:
 *
 *   - `promoteResolutions` — resolved failure diagnoses (with a fix
 *     PR/note) get pushed to the Phoenix `bufi-resolved-gaps` dataset,
 *     where `find_resolved_gap` reads them at agent runtime.
 *
 *   - `promoteSuccesses` — recently completed Open Agents sessions get
 *     pushed to the Phoenix `bufi-recall` dataset as positive examples
 *     for `recall_similar_runs`.
 *
 * **Idempotency.** Each Phoenix example carries `metadata.bufi_id`
 * (gap id for resolutions, session id for successes). Before insert
 * we fetch existing example metadata and skip ids we've already
 * pushed. Re-firing the cron after a partial run is safe.
 *
 * **Anti-injection (resolutions).** Only `provenance: "human-curated"`
 * lands in resolved-gaps — these are gaps a human PR closed.
 *
 * Both functions are pure orchestration. The Phoenix REST calls fail
 * soft; partial results are reported in the return shape.
 */

import { phoenixFetch } from "./_fetch";
import {
  getPhoenixApiKey,
  getPhoenixCollectorEndpoint,
  isPhoenixEnabled,
} from "./client";
import type { Provenance } from "./types";

export interface KnowledgeGapRow {
  id: string;
  hypothesis: string;
  toolName: string | null;
  kind: string;
  resolvedAt: Date | null;
  resolutionNote: string | null;
  suggestedFix: string | null;
  resolutionPrUrl: string;
}

export interface CompletedSessionRow {
  id: string;
  title: string;
  repo: string | null;
  traceId: string | null;
  source: string | null;
  completedAt: Date | null;
}

export interface PromoteResolutionsArgs {
  /** Rows fetched by the caller — DB access stays out of this package. */
  rows: KnowledgeGapRow[];
}

export interface PromoteSuccessesArgs {
  rows: CompletedSessionRow[];
}

export interface PromoteReport {
  available: boolean;
  reason?: string;
  attempted: number;
  pushed: number;
  skipped: number;
  errors: number;
}

export const RESOLUTIONS_DATASET = "bufi-resolved-gaps";
export const RECALL_DATASET = "bufi-recall";
const FETCH_TIMEOUT_MS = 6000;

export async function promoteResolutions(
  args: PromoteResolutionsArgs,
): Promise<PromoteReport> {
  if (!isPhoenixEnabled()) {
    return unavailableReport("phoenix-not-configured");
  }
  if (args.rows.length === 0) {
    return { available: true, attempted: 0, pushed: 0, skipped: 0, errors: 0 };
  }

  const ctx = makeRestCtx();
  const existing = await fetchExistingBufiIds(ctx, RESOLUTIONS_DATASET);
  if (!existing.ok) {
    return unavailableReport(existing.reason);
  }

  const candidates = args.rows
    .filter((row) => !existing.ids.has(row.id))
    .map(toResolvedGapExample);

  if (candidates.length === 0) {
    return {
      available: true,
      attempted: args.rows.length,
      pushed: 0,
      skipped: args.rows.length,
      errors: 0,
    };
  }

  const upload = await uploadAppendExamples(
    ctx,
    RESOLUTIONS_DATASET,
    candidates,
  );
  return {
    available: true,
    attempted: args.rows.length,
    pushed: upload.ok ? candidates.length : 0,
    skipped: args.rows.length - candidates.length,
    errors: upload.ok ? 0 : candidates.length,
    ...(upload.ok ? {} : { reason: upload.reason }),
  };
}

export async function promoteSuccesses(
  args: PromoteSuccessesArgs,
): Promise<PromoteReport> {
  if (!isPhoenixEnabled()) {
    return unavailableReport("phoenix-not-configured");
  }
  if (args.rows.length === 0) {
    return { available: true, attempted: 0, pushed: 0, skipped: 0, errors: 0 };
  }

  const ctx = makeRestCtx();
  const existing = await fetchExistingBufiIds(ctx, RECALL_DATASET);
  if (!existing.ok) {
    return unavailableReport(existing.reason);
  }

  const candidates = args.rows
    .filter((row) => !existing.ids.has(row.id))
    .map(toRecallExample);

  if (candidates.length === 0) {
    return {
      available: true,
      attempted: args.rows.length,
      pushed: 0,
      skipped: args.rows.length,
      errors: 0,
    };
  }

  const upload = await uploadAppendExamples(ctx, RECALL_DATASET, candidates);
  return {
    available: true,
    attempted: args.rows.length,
    pushed: upload.ok ? candidates.length : 0,
    skipped: args.rows.length - candidates.length,
    errors: upload.ok ? 0 : candidates.length,
    ...(upload.ok ? {} : { reason: upload.reason }),
  };
}

function unavailableReport(reason?: string): PromoteReport {
  return {
    available: false,
    ...(reason ? { reason } : {}),
    attempted: 0,
    pushed: 0,
    skipped: 0,
    errors: 0,
  };
}

// ── Mappers ─────────────────────────────────────────────────────────

interface DatasetExample {
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  metadata: Record<string, unknown> & {
    bufi_id: string;
    provenance: Provenance;
  };
}

function toResolvedGapExample(row: KnowledgeGapRow): DatasetExample {
  const fixSummary =
    row.resolutionNote?.trim() ||
    row.suggestedFix?.trim() ||
    "Resolved — see resolutionPrUrl for details.";
  return {
    input: { hypothesis: row.hypothesis },
    output: { fixSummary },
    metadata: {
      bufi_id: row.id,
      provenance: "human-curated",
      kind: row.kind,
      ...(row.toolName ? { toolName: row.toolName } : {}),
      resolutionPrUrl: row.resolutionPrUrl,
      mustMention: extractMustMention(fixSummary, row.toolName),
      ...(row.resolvedAt ? { resolvedAt: row.resolvedAt.toISOString() } : {}),
    },
  };
}

function toRecallExample(row: CompletedSessionRow): DatasetExample {
  return {
    input: { intent: row.title, ...(row.repo ? { repo: row.repo } : {}) },
    output: { outcome: "completed" },
    metadata: {
      bufi_id: row.id,
      provenance: "auto-promoted",
      ...(row.source ? { source: row.source } : {}),
      ...(row.traceId ? { traceId: row.traceId } : {}),
      ...(row.completedAt
        ? { completedAt: row.completedAt.toISOString() }
        : {}),
    },
  };
}

/**
 * Pull identifier-shaped tokens (camelCase, snake_case, ALL_CAPS,
 * tool names) out of the fix summary. These become the `mustMention`
 * tokens the agent should incorporate when retrying after a
 * `find_resolved_gap` hit.
 */
export function extractMustMention(
  text: string,
  toolName?: string | null,
): string[] {
  const out = new Set<string>();
  if (toolName) {
    out.add(toolName);
  }
  // Match identifiers — letters/digits/underscores, ≥4 chars, with mixed
  // case OR all-caps OR snake_case signal.
  const ids = text.match(/\b[A-Za-z][A-Za-z0-9_]{3,}\b/g) ?? [];
  for (const id of ids) {
    if (id.length < 4) {
      continue;
    }
    const isCamel = /[a-z][A-Z]/.test(id);
    const isSnake = id.includes("_");
    const isAllCaps = id === id.toUpperCase() && /[A-Z]{4,}/.test(id);
    if (isCamel || isSnake || isAllCaps) {
      out.add(id);
    }
  }
  return Array.from(out).slice(0, 6);
}

// ── REST plumbing ───────────────────────────────────────────────────

interface RestCtx {
  collector: string;
  headers: Record<string, string>;
}

function makeRestCtx(): RestCtx {
  const collector = getPhoenixCollectorEndpoint().replace(/\/$/, "");
  const apiKey = getPhoenixApiKey();
  return {
    collector,
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    },
  };
}

interface ExistingIdsResult {
  ok: boolean;
  ids: Set<string>;
  reason?: string;
}

async function fetchExistingBufiIds(
  ctx: RestCtx,
  datasetName: string,
): Promise<ExistingIdsResult> {
  try {
    const datasetId = await resolveDatasetIdByName(ctx, datasetName);
    if (!datasetId) {
      // Dataset doesn't exist yet — first promotion creates it.
      return { ok: true, ids: new Set() };
    }

    const url = new URL(
      `${ctx.collector}/v1/datasets/${encodeURIComponent(datasetId)}/examples`,
    );
    url.searchParams.set("limit", "500");
    const res = await phoenixFetch(url.toString(), {
      headers: ctx.headers,
      timeoutMs: FETCH_TIMEOUT_MS,
    });
    if (!res.ok) {
      return {
        ok: false,
        ids: new Set(),
        reason: `phoenix-http-${res.status}`,
      };
    }
    const data = (await res.json()) as {
      data?: Array<{ metadata?: Record<string, unknown> }>;
    } | null;
    const ids = new Set<string>();
    for (const example of data?.data ?? []) {
      const id = example.metadata?.bufi_id;
      if (typeof id === "string") {
        ids.add(id);
      }
    }
    return { ok: true, ids };
  } catch (error) {
    return {
      ok: false,
      ids: new Set(),
      reason:
        error instanceof Error
          ? `phoenix-process-${error.name}`
          : "phoenix-process-error",
    };
  }
}

async function resolveDatasetIdByName(
  ctx: RestCtx,
  name: string,
): Promise<string | null> {
  const url = new URL(`${ctx.collector}/v1/datasets`);
  url.searchParams.set("name", name);
  const res = await phoenixFetch(url.toString(), {
    headers: ctx.headers,
    timeoutMs: FETCH_TIMEOUT_MS,
  });
  if (!res.ok) {
    return null;
  }
  const data = (await res.json()) as {
    data?: Array<{ id?: string; name?: string }>;
  } | null;
  const list = Array.isArray(data?.data) ? data.data : [];
  return list.find((d) => d.name === name)?.id ?? null;
}

interface UploadResult {
  ok: boolean;
  reason?: string;
}

async function uploadAppendExamples(
  ctx: RestCtx,
  datasetName: string,
  examples: DatasetExample[],
): Promise<UploadResult> {
  if (examples.length === 0) {
    return { ok: true };
  }

  // Phoenix dataset upload supports `action: "append" | "create"`.
  // Append 404s when the dataset doesn't exist; fall through to create
  // on first call.
  const body = {
    action: "append",
    name: datasetName,
    inputs: examples.map((e) => e.input),
    outputs: examples.map((e) => e.output),
    metadata: examples.map((e) => e.metadata),
  };

  const url = `${ctx.collector}/v1/datasets/upload?sync=true`;
  try {
    const res = await phoenixFetch(url, {
      method: "POST",
      headers: ctx.headers,
      body: JSON.stringify(body),
      timeoutMs: FETCH_TIMEOUT_MS,
    });
    if (res.ok) {
      return { ok: true };
    }

    // Append failed — try create (dataset doesn't exist yet).
    if (res.status === 404) {
      const createRes = await phoenixFetch(url, {
        method: "POST",
        headers: ctx.headers,
        body: JSON.stringify({ ...body, action: "create" }),
        timeoutMs: FETCH_TIMEOUT_MS,
      });
      return createRes.ok
        ? { ok: true }
        : { ok: false, reason: `phoenix-http-${createRes.status}-on-create` };
    }

    return { ok: false, reason: `phoenix-http-${res.status}` };
  } catch (error) {
    return {
      ok: false,
      reason:
        error instanceof Error
          ? `phoenix-process-${error.name}`
          : "phoenix-process-error",
    };
  }
}
