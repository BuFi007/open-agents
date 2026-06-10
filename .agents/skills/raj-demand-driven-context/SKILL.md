---
name: raj-demand-driven-context
description: Dogfooding loop for vertical AI agents — three providers (Langfuse production-trace + Arize Phoenix agent-runtime self-introspection + Plurai developer eval iteration) plus four agent tools (report_knowledge_gap, list_available_tools, recall_similar_turns, find_resolved_gap) and the gap-scanner CLI, composed as one motion. Run during LIVE dogfooding sessions with a Monitor watching real-time inbound/outbound. Auto-curation crons (Phoenix promote-resolutions + promote-successes) compound the dataset without per-turn human work. STRICT DEV-ONLY at the agent layer (NODE_ENV + VERCEL_ENV + caller gate). Inspired by Raj Kapadia's "Demand-Driven Context" workshop (https://www.youtube.com/watch?v=_QAVExf_1uw).
---

# Raj's Demand-Driven Context — Sendero implementation

## Why this exists

Push-strategy retrieval (build all the MCPs, dump the wiki into a vector DB, hope the agent figures it out) caps at ~30% accuracy on real institutional knowledge. The agent ends up doing data-entry work for you. Raj's thesis: **flip to pull**. Give the agent a real task, let it fail, let it tell you what it needed to succeed, then fill the gap once and curate the answer back into a structured knowledge base.

Sendero implements the loop across **three observability planes** with four agent tools and a CLI:

| Plane                           | Provider                                                                | Audience       | Purpose                                                                                                            |
| ------------------------------- | ----------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Production turn scoring**     | [Langfuse](https://langfuse.com) (`@sendero/langfuse`)                  | Platform / ops | Prompt management, evaluators (4 LLM-judges per turn fire-and-forget), golden-turn regression, operator dashboards |
| **Agent runtime introspection** | [Arize Phoenix](https://arize.com/phoenix) (`@sendero/arize-phoenix`)   | Agent          | `recall_similar_turns` + `find_resolved_gap` — the agent reads its own past traces + curated resolutions mid-turn  |
| **Developer eval iteration**    | [Plurai](https://plurai.ai) (claude-code plugin `evals@plurai-plugins`) | Engineers      | Vibe-iterate eval rubrics in claude-code; promote locked rubrics into Langfuse / Phoenix                           |

| Surface                                                         | What it does                                                                                                                                                                                                              | Mode                                                  |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `report_knowledge_gap` (Sendero tool)                           | Agent self-reports a missing tool / wrong field name / dead instruction / missing env. Persisted to `KnowledgeGap` Postgres table, deduped by `sha256(kind\|tool\|hypothesisNorm)`.                                       | **Dev/sandbox only.**                                 |
| `list_available_tools` (Sendero tool)                           | Agent introspects the canonical tool catalog when uncertain. Returns name + scope + description + required/optional inputs.                                                                                               | **Dev/sandbox only.**                                 |
| `recall_similar_turns` (Sendero tool, `@sendero/arize-phoenix`) | Agent reads top-N past traces with similar intent for THIS tenant before planning. Returns summary + outcome + evalScore + appliedTools. Fail-soft on Phoenix outage.                                                     | **Dev/sandbox only.**                                 |
| `find_resolved_gap` (Sendero tool, `@sendero/arize-phoenix`)    | Agent looks up `sendero-resolved-gaps` Phoenix dataset before calling `report_knowledge_gap`. On hit: returns `fixSummary` + `mustMention` tokens; agent applies and retries. **Self-heals without a human in the loop.** | **Dev/sandbox only.**                                 |
| `bun gaps:scan` (CLI)                                           | Pulls open gaps, buckets by severity (auto-promotes blocking + repeat-offenders), writes `docs/agent-gaps/board.md` kanban. Optionally auto-resolves stale rows.                                                          | Dev / CI / cron.                                      |
| `phoenix-promote-resolutions` (Vercel cron, daily)              | Closed `KnowledgeGap` rows with `resolutionPrUrl` get pushed to `sendero-resolved-gaps` Phoenix dataset → `find_resolved_gap` reads them.                                                                                 | Production cron, idempotent on `metadata.sendero_id`. |
| `phoenix-promote-successes` (Vercel cron, every 6h)             | Confirmed bookings get pushed to `sendero-recall` Phoenix dataset → `recall_similar_turns` reads them.                                                                                                                    | Production cron, idempotent on `metadata.sendero_id`. |

This is **the missing observability layer for vertical AI agents** — and the magic is that the three planes feed each other. Langfuse traces become Phoenix recall data via auto-curation. Plurai-iterated eval rubrics become Langfuse judges. Closed gaps become self-heals on the next traveler turn.

## Where each plane feeds the loop

```
TRAVELER turn fires (any channel)
        │
        ▼
runAgentTurn → traceAgent stamps sendero.tenant_id on OTel span
        │
   ┌────┴─────┐                     (one span, two destinations
   ▼          ▼                      via shared NodeTracerProvider)
LANGFUSE   PHOENIX
        │          │
        │          ├─► recall_similar_turns reads past traces
        │          │     (tenant-scoped, eval≥0.7, age>1h)
        │          │
        │          └─► find_resolved_gap reads sendero-resolved-gaps
        │                (returns fixSummary + mustMention on hit)
        │
        └─► LLM-judge evaluators score the turn (fire-and-forget)
              │
              └─► high-eval traces auto-promoted to Phoenix recall dataset
                    (every 6h via phoenix-promote-successes cron)

When a tool fails AND no resolved-gap matches:
        │
        ▼
report_knowledge_gap → KnowledgeGap row (Postgres, dedup by sha256)
        │
        ▼ (human triage / PR with resolutionPrUrl)
        │
        ▼
phoenix-promote-resolutions cron (daily) →
  pushes resolved gap to sendero-resolved-gaps Phoenix dataset
        │
        ▼
NEXT TIME the same hypothesis fires →
  find_resolved_gap returns the fix → agent self-heals

Plurai overlay (developer-side):
  When a Langfuse eval flags a regression OR a gap board row needs a
  rubric, /evals:eval <description> drafts a new evaluator in claude-code.
  Locked rubric promotes back into Langfuse evaluators. The eval rubric
  itself becomes a versioned artifact, not a one-time script.
```

## The four canonical Sendero evals (Plurai-drafted, against responsible-AI ship gate)

```bash
/plugin marketplace add plurai-ai/plurai-plugins
/plugin install evals@plurai-plugins

# Each evaluator maps to a CLAUDE.md responsible-AI dimension
/evals:eval locale fidelity — agent reply must match user's last detected language; switch mid-thread
/evals:eval PII redaction — no full phone numbers, raw passport fields, or PASSPORT_VAULT_KEK material
/evals:eval grounding — tenant-specific claims must reference tool calls; no fabricated trip ids/PNRs
/evals:eval handoff trigger — escalate via request_human_handoff for irreversible payments / settlement / legal
```

Failing rows → `report_knowledge_gap` → eventual `find_resolved_gap` self-heal once the rubric stabilizes and a human PR closes the gap. **Plurai is the surface where the eval rubric matures; Langfuse/Phoenix is where it runs at scale.**

## When to use this skill

Invoke `/raj-demand-driven-context` (this skill) when:

- **You're starting a dogfooding session.** This is the primary use case — see "Dogfooding workflow" below. The three tools are designed to work _together_ during live testing, not separately after the fact.
- You're spinning up a new vertical AI agent template (real estate / legal / healthcare / freelance ops) and want the same demand-driven layer Sendero has.
- You're debugging a flaky agent and suspect it's missing context — pull the gap board first before manually grepping logs.
- You need to wire the gap-scanner output into an ops workflow (Vercel logs + Langfuse traces + Cloudflare worker logs).
- You're reviewing a PR that adds a new agent tool and want to ensure the description matches the schema (the load-bearing class of bug this layer was designed to catch).

## Dogfooding workflow — three tools, one motion

**The tools were built to be used together. Using them separately gets you 30% of the value.** A live dogfood session combines all three in a tight loop with a Monitor watching real-time events. Run this every time you ship a non-trivial agent change.

### Pre-flight (5 min before testing)

```bash
# 1. Snapshot the current gap board so you can diff after the session.
bun gaps:scan --output docs/agent-gaps/_pre-session.md --dry-run > /tmp/gaps-before.md

# 2. Pull live env from Vercel so localhost matches prod-shape.
vercel env pull .env.local

# 3. Boot dev server.
bun dev
```

Open three Claude Code shells:

- **Shell A** — your editor session (this skill loaded).
- **Shell B** — `Monitor` watching for the inbound traffic source. Examples:
  - WhatsApp dogfood: `Monitor` on `bun whatsapp:tail` or the Kapso event stream
  - Slack dogfood: `Monitor` on the Slack interactions webhook log
  - Web dogfood: `Monitor` on the dev server's request log
- **Shell C** — `Monitor` on `vercel logs --follow <preview-url>` for the deployed surface, OR `bun dev` console for local.

The Monitor pattern is the load-bearing piece. It surfaces real-time inbound/outbound events so the agent (Claude) can react to your live test traffic without you typing "what just happened?" each turn.

### Live loop (during the session)

Per-turn motion, repeated as you exercise the feature:

1. **Send a real test request** through the channel under test (WhatsApp message, Slack /command, web click).
2. **Monitor surfaces the event** to Shell A automatically.
3. **Watch what the agent does.** Three outcomes:
   - **Works** → move to the next test case.
   - **Fails recoverably** → the agent should call `list_available_tools({ keyword: '<thing it tried>' })` to introspect, then retry with the real tool name. Watch the trace.
   - **Fails unrecoverably** → the agent calls `report_knowledge_gap({ kind, toolName, errorMessage, hypothesis, suggestedFix?, blockingTraveler: true })` and escalates via `request_human_handoff`. The gap is now persisted.
4. **You walk the debugging chain in Shell A** while the next traveler turn is in flight (see `references/integration-vercel-langfuse-cloudflare.md`):
   - Read the gap entry that just landed.
   - Pull Langfuse trace via the `langfuse` MCP using `traceId` from the gap.
   - Pull Vercel logs for the failing tool path.
   - Identify the root cause + fix.
5. **Apply the fix.** Common shapes: prompt slab edit + Kapso push, env var set + redeploy, schema rename + Prisma migration. Push it live.
6. **Re-test the same scenario.** This is the load-bearing step — without re-test, you don't know if the fix actually closed the gap.
7. **The agent's next attempt** should either succeed (gap implicitly resolved) or report a _different_ gap (one fix surfaced the next layer of failure).

### Post-flight (5 min after testing)

```bash
# 1. Final gap-scan — what rows opened during the session?
bun gaps:scan
git diff docs/agent-gaps/board.md  # the diff IS the session retro

# 2. Auto-resolve anything that didn't recur (signal that the fix held).
bun gaps:scan --resolve-stale-days 1

# 3. For each NEW gap that's still open, decide: ship a real fix, file
# an issue, or mark `wontfix`. Don't leave critical/blocking rows
# undecided — they re-fire on the next live customer.

# 4. For each gap RESOLVED in this session, add the canonical input
# to the Langfuse golden-turns dataset. Closes the loop on Raj's
# "TDD with failed tests" — the prompt edit can't silently regress.
bun langfuse:dataset:seed
```

### Why this loop matters

- **Raj's pull-not-push thesis is wrong without the loop.** Pull alone is just "the agent fails, you patch, repeat." That's manual. The loop adds: the agent self-reports the failure shape, the scanner aggregates patterns, the regression closes the loop. Each iteration _compounds_ — your prompt slab + tool catalog get smarter every session, not just less broken.
- **Monitor is non-optional.** Without it, you're context-switching between three terminals + your phone. With it, the agent (Claude in Shell A) has the full session in its context and can debug end-to-end without re-explaining state.
- **Gap-scan diff IS the session retro.** Don't waste time writing one. `git diff docs/agent-gaps/board.md` between pre and post sessions tells the story: which rows opened, which closed, which escalated to high.
- **The three tools are not interchangeable.** `list_available_tools` is the agent's first move when uncertain; `report_knowledge_gap` is the second move when introspection didn't help; `gap-scan` is the human's third move to triage what the agent surfaced. Skipping the first two and only running the scanner periodically gets you a static board, not a closed loop.

### Canonical dogfood-found bugs (Sendero)

Each of these surfaced via the loop, not via code review or static analysis:

- **`documentImageUrl` vs `documentUrl`** — prompt slab named a field the schema didn't accept. Caught by the agent retrying twice, then `report_knowledge_gap({ kind: 'tool_input_mismatch' })`. Fix: rename in Story 4.2.
- **`request_human_handoff` not registered as Kapso top-level** — agent tried to call it directly; runtime returned "Tool not available." Caught by the agent then trying `handoff_to_human` (the foot-gun). Fix: prompt clarification + Kapso default-tools enum + unconditional ban.
- **`PASSPORT_VAULT_KEK` env not loaded** — Vercel env-add post-dated last deployment; runtime saw no KEK. Caught by `report_knowledge_gap({ kind: 'env_missing' })` + the agent escalating. Fix: redeploy after env change. **`readKek()` is intentionally inside a function (no module-level cache) so each call reads `process.env.PASSPORT_VAULT_KEK` fresh — function instance reuse can't pin stale env.**
- **`flowKey: 'trip_intake'` returning 500** — Meta Flow not configured. Caught by the agent retrying twice and falling through. Fix: prompt rule banning that flow key for passport intake; use `scan_passport_inline` instead.

Each one took ~10–15 minutes start-to-finish through the loop. None would have surfaced in a unit test or PR review — they were prompt-runtime mismatches that only show up under live traffic.

For the full dogfooding playbook, see `references/dogfooding-loop.md`.

## Hard rule: dev-only enforcement

**Three independent gates. ALL must pass for the gap-tool to actually persist a row:**

1. **Environment.** `NODE_ENV !== 'production'` OR `VERCEL_ENV ∈ {undefined, 'development'}`. Production + preview deploys are dead-zone.
2. **Caller key type.** `caller.effectiveKeyType !== 'production'`. Production prod-keys are refused regardless of environment — leaked credentials must not become a discovery surface.
3. **Tenant context.** No orphan rows. Refused if `ctx.traveler.tenantId` is missing.

Override (operator dashboard only): `SENDERO_GAPS_ALLOW_NONDEV=1` bypasses gate #1 but **never** bypasses gate #2.

Failure mode is **silent refusal** — the tool returns `{ status: 'production_refused', message }` rather than throwing. The agent reads this and falls back to `request_human_handoff` (the production-correct escalation path).

## Tools surface (canonical)

### `report_knowledge_gap`

```ts
report_knowledge_gap({
  kind: 'tool_input_mismatch' | 'tool_not_found' | 'tool_error_unrecoverable'
       | 'instruction_missing' | 'env_missing' | 'schema_drift'
       | 'runtime_constraint' | 'other',
  toolName?: string,            // "scan_passport_inline"
  errorMessage: string,         // verbatim from the failed call
  attemptedInput?: object,      // sanitized — NO PII / passport numbers / phone digits
  hypothesis: string,           // "I think field is named documentUrl, not documentImageUrl"
  suggestedFix?: string,        // "Rename in agent-persona.ts Story 4.2"
  blockingTraveler: boolean,    // true → severity rolls up to high/critical
  channelKind?: string,         // 'whatsapp' | 'slack' | 'web' | 'mcp'
  surface?: string,             // 'agent.dispatch' | 'agent.kapso' | 'agent.chat'
})
  → { status: 'reported' | 'duplicate_increment' | 'production_refused', gapId?, occurrenceCount? }
```

**Dedup contract.** Same `sha256(kind|toolName|normalize(hypothesis))` from multiple turns increments `occurrenceCount` on a single row. `last_seen_at` updates. Severity escalates but never downgrades.

### `list_available_tools`

```ts
list_available_tools({
  keyword?: string,             // 'passport' → scan_passport_inline + check_visa_requirements
  scope?: 'search' | 'bookings' | 'settlement' | 'treasury' | 'documents'
        | 'compliance' | 'trip_assistance' | 'utilities',
  limit?: number,               // default 15
})
  → {
      status: 'ok' | 'production_refused',
      tools: Array<{ name, scope, description, callMode, requiredInputs, optionalInputs }>,
      total, truncated,
    }
```

Filters by caller's granted scopes — sandbox sees `*`, user-minted prod keys see only what they can invoke. Internal tools (`internal: true` in `ToolDef`) are hidden from results so the agent doesn't accidentally surface ops-only tools to a customer.

### `recall_similar_turns` (Phoenix-backed, dev/sandbox-only)

```ts
recall_similar_turns({
  query: string,                // verbatim from the user's last message
  route?: string,               // optional restrictor: 'SFO-LHR'
  limit?: number,               // default 3, max 10
})
  → { status: 'ok' | 'unavailable' | 'production_refused',
      results: Array<{ traceId, summary, outcome, latencyMs, evalScore?,
                       appliedTools, provenance, occurredAt }>,
      message: string }
```

Filters span search by `sendero.tenant_id` (PR1 stamps), age > 1h (anti-injection), `evalScore ≥ 0.7`. Fail-soft: Phoenix down → `available: false`, agent plans cold.

### `find_resolved_gap` (Phoenix-backed, dev/sandbox-only)

```ts
find_resolved_gap({
  hypothesis: string,           // same shape as report_knowledge_gap.hypothesis
  toolName?: string,
  kind?: KnowledgeGapKind,
})
  → { status: 'found' | 'not_found' | 'unavailable' | 'production_refused',
      hit?: { fixSummary, mustMention[], resolutionPrUrl, ... },
      message: string }
```

**The agent calls this BEFORE `report_knowledge_gap`.** On hit: applies `mustMention` tokens, retries the original tool, never escalates. On miss: falls through to `report_knowledge_gap`. Token-overlap match in v0.1 (the 4 seeded bugs each have distinctive identifiers); v0.2 swaps to embedding similarity via Vertex `text-embedding-005`.

### `bun gaps:scan` CLI

```bash
bun gaps:scan                          # writes docs/agent-gaps/board.md
bun gaps:scan --since 2026-04-01       # custom lower bound on lastSeenAt
bun gaps:scan --resolve-stale-days 14  # auto-resolve rows not seen in 14d (blocking rows excluded)
bun gaps:scan --tenant org_xyz         # single-tenant slice
bun gaps:scan --dry-run                # print to stdout, don't touch the file
bun gaps:scan --output path/to/board.md  # alternate output path
```

Output structure: 🚨 Critical → ⚠️ High → 🛠 Medium → 📦 Low → ✅ Recently resolved. **Repeat-offender promotion** is the load-bearing rule: a row marked `severity=low` that fires 3+ times AND blocks travelers gets bucketed as `high` — the scanner is the truth, not the snapshotted column.

## How to wire into a NEW vertical AI agent template

When forking the Sendero template for a new vertical (real estate / legal / healthcare / etc.):

1. **Copy the schema.** `KnowledgeGap` model + 3 enums (`KnowledgeGapKind`, `KnowledgeGapSeverity`, `KnowledgeGapStatus`) — see `packages/database/prisma/schema.prisma` and the migration at `packages/database/prisma/migrations/20260505100000_add_knowledge_gap/`.
2. **Copy the tools.** `packages/tools/src/report-knowledge-gap.ts` + `packages/tools/src/list-available-tools.ts`. The dev-only gate, dedup helper, and severity inference are domain-agnostic — keep them as-is.
3. **Copy the scanner.** `scripts/scan-knowledge-gaps.ts` + `scripts/scan-knowledge-gaps-render.ts`. The render layer is split deliberately so unit tests don't pull in Prisma.
4. **Register in `toolList`.** Both tools must be in the canonical `toolList` (see `packages/tools/src/index.ts`) — the AI SDK adapter and MCP server derive their catalogs from it. Never wire them ad-hoc.
5. **Scope to `utilities`.** Both tools live in the `utilities` scope. Handler-level prod gate enforces dev-only — scope-gated would let a user-minted utilities key write to the gap table from production, which is not what we want.
6. **Persona slab.** Add this to your dispatch routing rules so the agent uses these tools at the right moment:

   ```
   ### Self-diagnostic tools (dev/sandbox only — silently no-op in prod)
   When you can't recover from a tool failure on a sandbox/dev turn:
   - After 2 consecutive 4xx/5xx OR a runtime "Tool X is not available",
     call list_available_tools({ keyword }) to discover what's registered.
   - If introspection still doesn't help, call report_knowledge_gap({
     kind, toolName, errorMessage, hypothesis, suggestedFix?, blockingTraveler })
     with a SPECIFIC hypothesis ("I think field is named X, not Y" — not
     "tool failed"). Same hypothesis from multiple turns dedups onto one
     row, so don't worry about spam.
   - Then escalate via request_human_handoff so the traveler isn't left
     waiting.
   - These tools are dev-mode only. In production they return
     production_refused and you must escalate via request_human_handoff
     directly.
   ```

7. **Add `bun gaps:scan` to `package.json`.** Plus an optional cron entry in `vercel.json` to run nightly with `--resolve-stale-days 14`.

For the full new-vertical playbook see `references/wiring-new-vertical.md`.

## Combine with: Vercel CLI logs + Langfuse MCP + Cloudflare MCP

The gap board is the entry point for an end-to-end debugging chain. When a critical gap appears, walk the chain:

1. **`bun gaps:scan`** — surfaces the gap. Read the hypothesis + suggestedFix.
2. **Langfuse MCP** (`/mcp` shows it; `mcp__langfuse-docs__searchLangfuseDocs` etc.) — every gap row carries a `traceId`. Pull the full trace to see what the agent was actually trying when it failed: input, tool calls, model reasoning. Use `getTrace` if available, else search by ID.
3. **Vercel CLI logs** — `vercel logs <deployment>` (or `vercel inspect`) for the server-side stack trace of the failing tool. The agent saw the response code + body; you see the throw site.
4. **Cloudflare MCP** (`mcp__cloudflare-workers__*`) — when the gap is in `runtime_constraint` or points at the edge worker (`sendero-arc-edge`), pull worker logs from CF. The edge surfaces things the Vercel function side can't see (request shape, edge cache hits, geo).

Together: gap → trace → server log → edge log. Four-line answer to "why didn't this work" in under five minutes, all from the same Claude Code session.

For the full integration playbook see `references/integration-vercel-langfuse-cloudflare.md`.

## Best practices

- **Don't expand the kind enum casually.** The 8 kinds (`tool_input_mismatch | tool_not_found | tool_error_unrecoverable | instruction_missing | env_missing | schema_drift | runtime_constraint | other`) cover the failure surface for vertical AI agents. New kinds need a corresponding routing rule in the scanner — otherwise they bucket into `other` and lose triage signal.
- **Hypothesis must be specific.** "Tool failed" is useless. "I think the field is named `documentUrl`, not `documentImageUrl`" closes the loop on its own. The dedup hash uses the hypothesis, so vague hypotheses both triage badly AND dedup poorly.
- **Don't sanitize PII at the SQL layer.** Sanitize at the agent's `attemptedInput` payload — the agent already knows what's PII because it was the one that constructed the call. Pushing this responsibility into Prisma triggers feels nice but loses signal (we WANT to know which fields were misnamed; we DON'T want to know which passport number was attempted).
- **Resolution is human, not auto.** `bun gaps:scan --resolve-stale-days N` only marks **non-blocking** rows as resolved when they fall out of the recurring window. A blocking row stays open until a human PR closes it with a `resolutionPrUrl`. This is intentional — auto-resolving a blocking gap because nobody hit it for 2 weeks is exactly the wrong move.
- **Don't run gaps:scan in CI on every PR.** Run it nightly via cron. The gap board reflects real-world traffic; PR-level scans race against test fixtures and produce noise.
- **Never wire `SENDERO_GAPS_ALLOW_NONDEV=1` into the agent runtime.** It's reserved for the `/dashboard/agent-gaps` operator UI's manual "file a gap" button. If you find yourself wanting it in agent code, you're using the wrong tool — escalate via `request_human_handoff` instead.
- **Pair with Langfuse regression.** Every closed gap should have a paired entry in `sendero-golden-turns` so a future prompt regression can't silently re-open it. The hypothesis text often becomes the rule-match `mustMention` field.
- **Scan output is committed.** `docs/agent-gaps/board.md` is checked into git. The git history of the board IS the institutional knowledge of "what did our agent struggle with last quarter?" — an artifact you'd otherwise have to scrape from Slack threads.

## Anti-patterns (Raj's drawbacks, restated for our stack)

- **Don't build this for a tiny team with great docs.** If your prompt slab is 200 lines and your tool catalog is 8 tools, you don't need this. The whole point is surfacing what's not documented in a sprawling system.
- **Don't try to manually fill gaps for 50 incidents in one sitting.** Raj said this is exhausting; he's right. Run the scanner, fix the top 3 critical, ship, let the next 24h of agent traffic surface what actually matters.
- **Don't conflate gap severity with bug priority.** A `medium` gap on a frequently-used tool is more urgent than a `critical` gap on a tool nobody calls. The scanner shows occurrence × severity together for a reason.

## Files in this skill

- `SKILL.md` — this file
- `references/wiring-new-vertical.md` — step-by-step playbook for forking the pattern into a new vertical AI agent template
- `references/integration-vercel-langfuse-cloudflare.md` — debugging chain workflow combining Vercel CLI + Langfuse MCP + Cloudflare MCP

## Reference

- Raj Kapadia, "Demand-Driven Context for AI Agents", 2026 (workshop video): https://www.youtube.com/watch?v=_QAVExf_1uw
- Sendero implementation: `packages/tools/src/report-knowledge-gap.ts`, `packages/tools/src/list-available-tools.ts`, `scripts/scan-knowledge-gaps.ts`
- Schema: `packages/database/prisma/schema.prisma` → `model KnowledgeGap`
- Persona wiring: `apps/app/lib/agent-persona.ts` → "Self-diagnostic tools" section
