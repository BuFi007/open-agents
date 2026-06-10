# Wiring demand-driven context into a new vertical AI agent template

When forking the Sendero template for a new vertical (real-estate-agent, legal-intake, healthcare-booking, freelance-ops, etc.), inherit the observability layer in roughly this order. Each step is independent — you can ship #1-#3 in one PR and add the rest as the vertical matures.

## 1. Prisma schema

Append to `packages/database/prisma/schema.prisma`:

- `model KnowledgeGap` (with `tenantId`, `kind`, `severity`, `status`, `toolName`, `errorMessage`, `hypothesis`, `suggestedFix`, `blockingTraveler`, `dedupKey`, `occurrenceCount`, `firstSeenAt`/`lastSeenAt`, `resolutionPrUrl`)
- `enum KnowledgeGapKind` — keep the canonical 8 (`tool_input_mismatch` | `tool_not_found` | `tool_error_unrecoverable` | `instruction_missing` | `env_missing` | `schema_drift` | `runtime_constraint` | `other`)
- `enum KnowledgeGapSeverity` (`low` | `medium` | `high` | `critical`)
- `enum KnowledgeGapStatus` (`open` | `triaged` | `in_progress` | `resolved` | `duplicate` | `wontfix`)

Indexes that matter (the scanner queries against these):

```sql
@@unique([tenantId, dedupKey])
@@index([tenantId, status, severity, lastSeenAt(sort: Desc)])
@@index([tenantId, kind, status])
@@index([toolName, status])
@@index([traceId])
```

Migration name convention: `<timestamp>_add_knowledge_gap`. Pre-migration lint runs in pre-commit (see `scripts/check-prisma-migrations.ts`); concurrent indexes aren't required because the table is empty on creation.

## 2. The two tools

Copy verbatim into `packages/tools/src/`:

- `report-knowledge-gap.ts`
- `list-available-tools.ts`

Both files are domain-agnostic. The dev-only gate, dedup helper, severity inference, and scope-filter logic don't reference any travel-specific behavior — they work for any vertical.

Register both in `packages/tools/src/index.ts`:

```ts
import { reportKnowledgeGapTool } from './report-knowledge-gap';
import { listAvailableToolsTool } from './list-available-tools';

// inside toolList[]:
  reportKnowledgeGapTool,
  listAvailableToolsTool,
```

Add named exports for testability:

```ts
export {
  type ReportKnowledgeGapInput,
  type ReportKnowledgeGapResult,
  type ReportKnowledgeGapDeps,
  runReportKnowledgeGap,
  reportKnowledgeGapTool,
} from './report-knowledge-gap';
export {
  type ListAvailableToolsInput,
  type ListAvailableToolsResult,
  type ListAvailableToolsDeps,
  type ListedTool,
  runListAvailableTools,
  listAvailableToolsTool,
} from './list-available-tools';
```

Scope mapping in `packages/tools/src/scopes.ts`:

```ts
if (toolName === 'report_knowledge_gap' || toolName === 'list_available_tools') {
  return 'utilities';
}
```

The handler-level prod gate is what enforces dev-only — scope-gating would be wrong because it'd let a user-minted utilities key write into the gap table from prod.

## 3. The CLI scanner

Copy:

- `scripts/scan-knowledge-gaps.ts` (CLI shell, imports Prisma)
- `scripts/scan-knowledge-gaps-render.ts` (pure rendering helpers, no DB deps)

Add to root `package.json`:

```json
"scripts": {
  "gaps:scan": "bun run scripts/scan-knowledge-gaps.ts"
}
```

The split between CLI shell + render helpers is deliberate — unit tests import from the render module without spinning up Prisma. Don't fold them back together.

## 4. Persona slab

Add to your dispatch routing rules (e.g. `apps/app/lib/agent-persona.ts` or wherever your prompt slab lives):

```
### Self-diagnostic tools (dev/sandbox only — silently no-op in prod)
When you can't recover from a tool failure on a sandbox/dev turn:
- After 2 consecutive 4xx/5xx OR a runtime "Tool X is not available",
  call list_available_tools({ keyword }) to discover what's registered.
  Match the tool name your prompt referenced (often a one-character
  rename: documentImageUrl vs documentUrl).
- If introspection still doesn't resolve it, call report_knowledge_gap({
  kind, toolName, errorMessage, hypothesis, suggestedFix?,
  blockingTraveler }) with a SPECIFIC hypothesis ("I think field is
  named X, not Y" — not "tool failed"). Same hypothesis from multiple
  turns dedups onto one row.
- Then escalate via request_human_handoff so the user isn't waiting.
- These tools are dev-mode only. In production they return
  production_refused; you must escalate via request_human_handoff
  directly.
```

## 5. Ops surfaces (optional but recommended)

- **Operator dashboard at `/dashboard/agent-gaps`.** Server component that reads `KnowledgeGap` and renders the same kanban the markdown board shows. Needed when the team scales past one engineer triaging.
- **Liveblocks notification on critical gaps.** Pair with the existing `notifyOperatorHandoff` pattern — fan out a `$gapCritical` inbox notification when severity rolls up to critical OR a row hits 5+ occurrences. Operators who already watch the support inbox catch agent-broken-itself signals in the same place.
- **Nightly cron.** `vercel.json` cron entry that runs `bun gaps:scan --resolve-stale-days 14` and commits the diff via GitHub Actions to `docs/agent-gaps/board.md`. The committed diff is your weekly retro material.
- **CI tool-description self-test.** For each tool whose `description` or `inputSchema` changed in a PR, run a one-shot LLM eval: "Given this description, construct a minimal valid input. If your input is rejected by the schema, the description is misleading." Catches the load-bearing typo class (`documentImageUrl` vs `documentUrl`) before merge. ~$0.001/tool/PR on `gpt-4o-mini`.
- **Langfuse regression auto-promotion.** Every closed gap → new entry in your `<vertical>-golden-turns` Langfuse dataset. Closes the loop on Raj's "TDD with failed tests" — a prompt regression that re-opens the gap fails the regression suite.

## 6. Tests to copy

- `packages/tools/src/report-knowledge-gap.test.ts` — production gate, dedup behavior, severity inference, prod-key reject. ~17 assertions.
- `packages/tools/src/list-available-tools.test.ts` — scope filter, internal-tool hiding, keyword search, pagination. ~14 assertions.
- `scripts/scan-knowledge-gaps.test.ts` — bucket promotion, markdown shape, CLI arg parsing. ~26 assertions.

All hermetic — no DB, no network. Should run green out of the box.

## What NOT to copy

- **The Sendero-specific persona examples.** Story 4.2 (passport intake), Story 4 (insufficient funds) are travel-specific. Your vertical has its own user-blocking branches; identify those and write the equivalent slab. Do NOT carry over Sendero's specific stories — they'll confuse your agent.
- **The `request_human_handoff` Sendero tool.** That's a Sendero-side tool; your vertical needs its own escalation that creates a handoff row in your domain's `ChannelHandoff` (or equivalent) table and notifies your operators. The pattern (Liveblocks notification + Slack post + dashboard surface) is what to copy; the implementation is per-vertical.
- **The exact `KIND_LABEL` strings in the scanner output.** They're fine as-is; just don't think they're load-bearing. Tweak per vertical taste.

## Sanity checklist before considering it shipped

- [ ] Both tools registered in `toolList`.
- [ ] Both tools scoped to `utilities` in `scopes.ts`.
- [ ] Migration applied in dev + ready for prod (concurrent index creation isn't needed — empty table).
- [ ] Persona slab updated with the self-diagnostic rules.
- [ ] `bun gaps:scan --dry-run` produces a "🎉 No open gaps" board on a fresh DB.
- [ ] Tests green: `bun test packages/tools/src/report-knowledge-gap.test.ts packages/tools/src/list-available-tools.test.ts scripts/scan-knowledge-gaps.test.ts`.
- [ ] Smoke: from a sandbox key, call `report_knowledge_gap({ kind: 'other', errorMessage: 'smoke', hypothesis: 'first row to verify the table writes' })` and confirm the row appears + the next `bun gaps:scan` surfaces it.
